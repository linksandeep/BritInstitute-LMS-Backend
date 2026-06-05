import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { Assignment } from '../models/Assignment.model';
import { AssignmentSubmission } from '../models/AssignmentSubmission.model';
import { Attendance } from '../models/Attendance.model';
import { Batch } from '../models/Batch.model';
import { Booking } from '../models/Booking.model';
import { CertificateRequest } from '../models/CertificateRequest.model';
import { Curriculum } from '../models/Curriculum.model';
import { LectureProgress } from '../models/LectureProgress.model';
import { LiveClass } from '../models/LiveClass.model';
import { RecordedLecture } from '../models/RecordedLecture.model';
import { formatUkDateTime } from '../utils/ukTime';

const clampPercent = (value: number) => Math.max(0, Math.min(100, value));

const getClassEndAt = (liveClass: { scheduledAt: Date; duration: number }) =>
  new Date(new Date(liveClass.scheduledAt).getTime() + liveClass.duration * 60 * 1000);

const isFinishedClass = (liveClass: { status?: string; scheduledAt: Date; duration: number }) =>
  liveClass.status === 'ended' || (liveClass.status !== 'live' && getClassEndAt(liveClass).getTime() < Date.now());

const getStudentPortalSnapshot = async (studentId: string) => {
  const batches = await Batch.find({ students: studentId, isActive: true })
    .populate('course', 'title description')
    .sort({ startDate: -1 });
  const batchIds = batches.map((batch) => batch._id);

  const [
    liveClasses,
    assignments,
    lectures,
    submissions,
    lectureProgress,
    bookings,
    curriculums,
  ] = await Promise.all([
    LiveClass.find({ batch: { $in: batchIds } }).sort({ scheduledAt: -1 }),
    Assignment.find({ batch: { $in: batchIds } }).sort({ dueDate: 1 }),
    RecordedLecture.find({ batch: { $in: batchIds } }).sort({ order: 1, createdAt: -1 }),
    AssignmentSubmission.find({ student: studentId }),
    LectureProgress.find({ student: studentId }),
    Booking.find({ student: studentId }).sort({ dateTime: 1 }),
    Curriculum.find({ batch: { $in: batchIds } }),
  ]);

  const submissionAssignmentIds = new Set(submissions.map((submission) => String(submission.assignment)));
  const completedLectureIds = new Set(
    lectureProgress
      .filter((progress) => progress.isCompleted || progress.watchDuration >= 600)
      .map((progress) => String(progress.lecture))
  );

  const finishedClasses = liveClasses.filter(isFinishedClass);
  const attendanceRecords = await Attendance.find({
    student: studentId,
    liveClass: { $in: finishedClasses.map((liveClass) => liveClass._id) },
  });
  const presentClassIds = new Set(
    attendanceRecords
      .filter((attendance) => attendance.status === 'present')
      .map((attendance) => String(attendance.liveClass))
  );
  const attendedClasses = finishedClasses.filter((liveClass) => presentClassIds.has(String(liveClass._id)));
  const missedClasses = finishedClasses.filter((liveClass) => !presentClassIds.has(String(liveClass._id)));

  const submittedAssignments = assignments.filter((assignment) => submissionAssignmentIds.has(String(assignment._id)));
  const pendingAssignments = assignments.filter((assignment) => !submissionAssignmentIds.has(String(assignment._id)));
  const completedLectures = lectures.filter((lecture) => completedLectureIds.has(String(lecture._id)));

  const now = Date.now();
  const ongoingClasses = liveClasses.filter((liveClass) => {
    const startAt = new Date(liveClass.scheduledAt).getTime();
    const endAt = getClassEndAt(liveClass).getTime();
    return liveClass.status !== 'ended' && (liveClass.status === 'live' || (startAt <= now && endAt >= now));
  });
  const upcomingClasses = liveClasses.filter((liveClass) => liveClass.status !== 'ended' && new Date(liveClass.scheduledAt).getTime() > now);

  const curriculumTopics = curriculums.reduce(
    (sum, curriculum) =>
      sum + curriculum.modules.reduce((moduleSum, module) => moduleSum + module.topics.length, 0),
    0
  );
  const scheduledTopics = curriculums.reduce(
    (sum, curriculum) =>
      sum + curriculum.modules.reduce(
        (moduleSum, module) => moduleSum + module.topics.filter((topic) => Boolean(topic.scheduledAt)).length,
        0
      ),
    0
  );

  const totalTrackedItems = Math.max(1, liveClasses.length + lectures.length + assignments.length);
  const learningProgress = clampPercent(
    Math.round(((attendedClasses.length + completedLectures.length + submittedAssignments.length) / totalTrackedItems) * 100)
  );
  const attendanceRate = finishedClasses.length
    ? Math.round((attendedClasses.length / finishedClasses.length) * 100)
    : 0;
  const recordingCompletion = lectures.length
    ? Math.round((completedLectures.length / lectures.length) * 100)
    : 0;
  const assignmentCompletion = assignments.length
    ? Math.round((submittedAssignments.length / assignments.length) * 100)
    : 0;

  const nextClass = [...ongoingClasses, ...upcomingClasses]
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())[0] || null;

  const activeBatch = batches[0] || null;
  const activeCourse = activeBatch?.course as unknown as { _id?: string; title?: string; description?: string } | undefined;
  const certificateRequest = activeBatch
    ? await CertificateRequest.findOne({
      student: studentId,
      batch: activeBatch._id,
      course: activeCourse?._id,
    }).sort({ createdAt: -1 })
    : null;

  return {
    activeBatch: activeBatch ? {
      id: String(activeBatch._id),
      name: activeBatch.name,
      course: activeCourse ? {
        id: String(activeCourse._id),
        title: activeCourse.title || '',
        description: activeCourse.description || '',
      } : null,
    } : null,
    certificateRequest: certificateRequest ? {
      id: String(certificateRequest._id),
      status: certificateRequest.status,
      requestedAt: certificateRequest.requestedAt,
    } : null,
    metrics: {
      learningProgress,
      attendanceRate,
      recordingCompletion,
      assignmentCompletion,
      totalLiveClasses: liveClasses.length,
      ongoingClasses: ongoingClasses.length,
      upcomingClasses: upcomingClasses.length,
      attendedClasses: attendedClasses.length,
      missedClasses: missedClasses.length,
      finishedClasses: finishedClasses.length,
      totalLectures: lectures.length,
      completedLectures: completedLectures.length,
      totalAssignments: assignments.length,
      submittedAssignments: submittedAssignments.length,
      pendingAssignments: pendingAssignments.length,
      curriculumTopics,
      scheduledTopics,
      mentoringSessions: bookings.length,
    },
    nextClass: nextClass ? {
      id: String(nextClass._id),
      classNumber: nextClass.classNumber,
      topic: nextClass.topic,
      scheduledAt: nextClass.scheduledAt,
      duration: nextClass.duration,
      status: ongoingClasses.some((liveClass) => String(liveClass._id) === String(nextClass._id)) ? 'live' : 'upcoming',
    } : null,
  };
};

const buildAnnouncements = (snapshot: Awaited<ReturnType<typeof getStudentPortalSnapshot>>) => {
  const announcements = [];

  announcements.push(
    snapshot.metrics.pendingAssignments > 0
      ? `${snapshot.metrics.pendingAssignments} assignment${snapshot.metrics.pendingAssignments === 1 ? '' : 's'} waiting for submission.`
      : 'All visible assignments are submitted.'
  );

  announcements.push(
    snapshot.nextClass
      ? `Next class: ${snapshot.nextClass.topic} at ${formatUkDateTime(new Date(snapshot.nextClass.scheduledAt))}.`
      : 'Your next class schedule will appear here once published.'
  );

  announcements.push(
    snapshot.metrics.totalLectures > 0
      ? `${snapshot.metrics.totalLectures} class recording${snapshot.metrics.totalLectures === 1 ? '' : 's'} available for revision.`
      : 'Class recordings will unlock after completed sessions.'
  );

  return announcements;
};

const buildRecommendations = (snapshot: Awaited<ReturnType<typeof getStudentPortalSnapshot>>) => [
  {
    title: 'Revision',
    action: snapshot.metrics.totalLectures > snapshot.metrics.completedLectures
      ? 'Continue recorded lectures'
      : 'Keep your class notes warm',
  },
  {
    title: 'Practice',
    action: snapshot.metrics.pendingAssignments > 0
      ? 'Submit pending assignment work'
      : 'Prepare portfolio evidence',
  },
  {
    title: 'Mentoring',
    action: snapshot.metrics.mentoringSessions > 0
      ? 'Review mentor feedback'
      : 'Book a doubt clearing session',
  },
  {
    title: 'Class readiness',
    action: snapshot.nextClass
      ? `Prepare for ${snapshot.nextClass.classNumber}`
      : 'Watch for the next schedule',
  },
];

const buildCertificate = (snapshot: Awaited<ReturnType<typeof getStudentPortalSnapshot>>) => {
  const requirements = [
    {
      label: 'Progress above 80%',
      value: snapshot.metrics.learningProgress,
      target: 80,
      passed: snapshot.metrics.learningProgress >= 80,
    },
    {
      label: 'Attendance above 70%',
      value: snapshot.metrics.attendanceRate,
      target: 70,
      passed: snapshot.metrics.attendanceRate >= 70,
    },
    {
      label: 'Assignments submitted',
      value: snapshot.metrics.submittedAssignments,
      target: snapshot.metrics.totalAssignments,
      passed: snapshot.metrics.totalAssignments === 0 || snapshot.metrics.submittedAssignments >= snapshot.metrics.totalAssignments,
    },
  ];

  return {
    status: requirements.every((requirement) => requirement.passed) ? 'eligible' : 'locked',
    isEligible: requirements.every((requirement) => requirement.passed),
    requirements,
    request: snapshot.certificateRequest,
  };
};

export const getStudentPortalSummary = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const snapshot = await getStudentPortalSnapshot(req.user!.id);

    res.json({
      success: true,
      summary: {
        ...snapshot,
        announcements: buildAnnouncements(snapshot),
        recommendations: buildRecommendations(snapshot),
        certificate: buildCertificate(snapshot),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Unable to load student portal summary' });
  }
};

export const createStudyPlan = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const prompt = String(req.body.prompt || '').trim();
    if (!prompt) {
      res.status(400).json({ success: false, message: 'Please enter a study goal or choose a prompt.' });
      return;
    }

    const snapshot = await getStudentPortalSnapshot(req.user!.id);
    const focus = snapshot.metrics.pendingAssignments > 0
      ? 'clear your pending assignment work first'
      : snapshot.metrics.totalLectures > snapshot.metrics.completedLectures
        ? 'revise the next available class recording'
        : snapshot.nextClass
          ? `prepare for ${snapshot.nextClass.topic}`
          : 'review your curriculum roadmap and prepare one question for your mentor';

    const steps = [
      'Spend 5 minutes writing the exact outcome you want from this study block.',
      `Use a 25 minute focus session to ${focus}.`,
      'Finish with one practical output: notes, a solved task, or one mentor question.',
    ];

    if (snapshot.metrics.pendingAssignments > 0) {
      steps.push('Submit or update at least one assignment item before ending the session.');
    }

    if (snapshot.metrics.totalLectures > snapshot.metrics.completedLectures) {
      steps.push('Watch one pending recorded lecture and mark progress by staying in the LMS player.');
    }

    res.json({
      success: true,
      plan: {
        prompt,
        response: `For ${prompt}, start with a focused study block and ${focus}. Keep the session practical so it improves your progress inside the LMS.`,
        steps,
        metrics: snapshot.metrics,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Unable to generate study plan' });
  }
};

export const requestCertificate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const snapshot = await getStudentPortalSnapshot(req.user!.id);
    const certificate = buildCertificate(snapshot);

    if (!snapshot.activeBatch) {
      res.status(400).json({ success: false, message: 'You must be in an active batch before requesting a certificate.' });
      return;
    }

    if (!certificate.isEligible) {
      res.status(400).json({ success: false, message: 'Certificate requirements are not completed yet.' });
      return;
    }

    if (certificate.request && ['pending', 'approved', 'issued'].includes(certificate.request.status)) {
      res.json({ success: true, message: 'Certificate request already exists.', request: certificate.request });
      return;
    }

    const request = await CertificateRequest.findOneAndUpdate(
      {
        student: req.user!.id,
        batch: snapshot.activeBatch.id,
        course: snapshot.activeBatch.course?.id,
      },
      {
        student: req.user!.id,
        batch: snapshot.activeBatch.id,
        course: snapshot.activeBatch.course?.id,
        status: 'pending',
        requestedAt: new Date(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.status(201).json({
      success: true,
      message: 'Certificate request submitted for review.',
      request: {
        id: String(request._id),
        status: request.status,
        requestedAt: request.requestedAt,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Unable to request certificate' });
  }
};
