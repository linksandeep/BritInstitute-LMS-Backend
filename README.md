# Brit Institute LMS Backend

Backend API for the Brit Institute Learning Management System. It powers authentication, user management, courses, batches, curriculum templates, live classes, recorded lectures, assignments, 1:1 mentor sessions, activity tracking, certificates, and Zoom meeting integration.

## Project Overview

This service is built with Node.js, Express, TypeScript, and MongoDB through Mongoose. The API is consumed by the React frontend and exposes role-based LMS functionality for:

- Super admins
- Admins
- Teachers / mentors
- Students

Key backend features include:

- JWT authentication and session tracking
- Configurable inactivity timeout
- Course, batch, and curriculum management
- Batch-specific live class scheduling
- Recorded lecture access and progress tracking
- Assignment submission and review
- 1:1 mentor booking with teacher slot conflict prevention
- Zoom meeting creation, update, deletion, and webhook support
- Student dashboard analytics and certificate request flow

## Prerequisites

Install the following before running the backend:

- Node.js 18 or newer
- npm 9 or newer
- MongoDB database, local or MongoDB Atlas
- Git
- Optional: Zoom Server-to-Server OAuth app credentials for Zoom meeting automation

## Environment Variables

Create a `.env` file in the backend directory:

```bash
cd backend
cp .env.example .env
```

If `.env.example` is not present, create `.env` manually with:

```env
PORT=5001
NODE_ENV=development
MONGO_URI=mongodb://localhost:27017/britInstiuteLMS
JWT_SECRET=replace_with_a_strong_secret
JWT_EXPIRES_IN=7d
FRONTEND_URL=http://localhost:5173
INACTIVITY_TIMEOUT_MINUTES=30
LICENSE_KEY=Licence@4545
LICENSE_MONGO_URI=mongodb://localhost:27017/britInstituteLicense
LICENSE_MONGO_DB_NAME=britInstituteLicense
LICENSE_VALIDATION_INTERVAL_MS=60000
LICENSE_MAX_ACTIVATION_ATTEMPTS=3
LICENSE_ACTIVATION_LOCKOUT_MS=900000
LICENSE_INITIAL_MINUTES=
LICENSE_INITIAL_DAYS=7
LICENSE_ENCODED_VALUE=QnhjshjE9:9:
LICENSE_SUPER_CODE=
LICENSE_SUPER_ENCODED_VALUE=jfi|fwi

# Optional Zoom integration
ZOOM_ACCOUNT_ID=
ZOOM_CLIENT_ID=
ZOOM_CLIENT_SECRET=
ZOOM_WEBHOOK_SECRET_TOKEN=
```

Important notes:

- Never commit real `.env` secrets to GitHub.
- `INACTIVITY_TIMEOUT_MINUTES` is optional. If not provided, the API defaults to 30 minutes.
- `LICENSE_KEY` is the entered license. If its +5 encoded value matches `LICENSE_SUPER_ENCODED_VALUE`, database checks are skipped.
- `LICENSE_SUPER_CODE=eadward` enables permanent super mode without checking the license database. If `LICENSE_SUPER_CODE` is present but wrong, the app locks and does not fall back to database validation.
- `LICENSE_MONGO_URI` can point to a separate license database from the main LMS database.
- `LICENSE_VALIDATION_INTERVAL_MS` controls how often the database license is rechecked while the server is running.
- `LICENSE_MAX_ACTIVATION_ATTEMPTS` and `LICENSE_ACTIVATION_LOCKOUT_MS` control the wrong-key lockout on the activation popup.
- The database `licenc` collection stores the plain `license` value. The app encodes it with +5 before comparing it to `LICENSE_ENCODED_VALUE`.
- `ZOOM_*` values are required only if you want automatic Zoom meeting creation and updates.

## Installation

```bash
cd backend
npm install
```

## Run Locally

Development mode with automatic reload:

```bash
npm run dev
```

Production-style local run:

```bash
npm run build
npm start
```

Default local backend URL:

```text
http://localhost:5001
```

Health check:

```bash
curl http://localhost:5001/
```

Expected response:

```json
{
  "status": "ok",
  "message": "Brit Institute LMS API",
  "version": "1.0.0"
}
```

## Available Scripts

```bash
npm run dev
```

Starts the backend with `nodemon` and `ts-node`.

```bash
npm run build
```

Compiles TypeScript into the `dist` folder.

```bash
npm start
```

Runs the compiled backend from `dist/app.js`.

```bash
npm run seed
```

Seeds the Data Analyst and Applied GenAI curriculum template. The current seed does not clear users, batches, attendance, assignments, or activity records.

## Database Setup

The backend uses MongoDB with Mongoose models. There are no separate migration files at the moment.

To set up the database:

1. Create a MongoDB database locally or in MongoDB Atlas.
2. Add the connection string to `MONGO_URI`.
3. Start the backend.
4. Run the curriculum seed if needed:

```bash
npm run seed
```

Mongoose creates configured indexes automatically when the app connects. Current important indexes include:

- Attendance uniqueness per student and live class
- Lecture progress uniqueness per student and lecture
- Certificate request uniqueness per student, batch, and course
- Booking lookup indexes for mentor/time conflict checks

## Default Credentials

The current seed file creates curriculum data only. It does not create default users or passwords.

Create users from the LMS admin/super admin interface or insert the first super admin using a controlled internal setup process. Do not hard-code production credentials in the repository.

## API Overview

Base URL:

```text
http://localhost:5001/api
```

Main route groups:

- `POST /auth/login` - user login
- `GET /auth/me` - current authenticated user
- `PUT /auth/password` - change the authenticated user's password
- `GET /auth/session-config` - inactivity timeout config
- `POST /auth/heartbeat` - update user activity
- `POST /auth/logout` - close current session
- `/admin/users` - student management
- `/admin/courses` - course management
- `/admin/batches` - batch management
- `/superadmin/teachers` - teacher management
- `/curriculums/defaults` - curriculum template management
- `/curriculums/batch/:batchId` - batch curriculum management
- `/live-classes` - live class scheduling and attendance
- `/recorded` - recorded lectures and progress
- `/assignments` - assignments and submissions
- `/sessions` - 1:1 mentor bookings
- `/student-portal` - student dashboard summaries, AI study plan, certificates

Most endpoints require a bearer token:

```bash
curl http://localhost:5001/api/auth/me \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## 1:1 Booking Notes

The mentor booking system prevents double-booking by checking overlapping active appointments for the same mentor.

Blocking statuses:

- `pending`
- `accepted`

Available slot endpoint:

```text
GET /api/sessions/mentors/:mentorId/availability?date=YYYY-MM-DD
```

If a duplicate slot is requested, the API returns:

```json
{
  "success": false,
  "message": "This slot is already booked for this mentor. Please choose another available time."
}
```

## Deployment

Typical deployment steps:

1. Provision MongoDB.
2. Configure environment variables on the hosting provider.
3. Install dependencies with `npm install`.
4. Build the backend with `npm run build`.
5. Start with `npm start`.
6. Set `FRONTEND_URL` to the deployed frontend domain.
7. Configure Zoom credentials if Zoom automation is required.

For Render, Railway, or similar Node hosts:

- Build command: `npm install && npm run build`
- Start command: `npm start`
- Root directory: `backend`

## Troubleshooting

Backend does not start:

- Check `MONGO_URI`.
- Confirm MongoDB network access allows your IP or hosting provider.
- Make sure `PORT` is not already in use.

Frontend cannot call API:

- Confirm backend is running on `http://localhost:5001`.
- Confirm frontend `.env` has `VITE_API_URL=http://localhost:5001/api`.
- Confirm `FRONTEND_URL` allows the frontend origin.

Login fails:

- Confirm user exists and is active.
- Confirm password is correct.
- Confirm `JWT_SECRET` did not change between login and authenticated requests.

Zoom meeting creation fails:

- Confirm all `ZOOM_*` values are correct.
- Confirm the Zoom app has permissions to create, update, and delete meetings.

Slot booking conflict issues:

- Confirm requested booking date/time is in the future.
- Confirm the same mentor does not already have a `pending` or `accepted` booking that overlaps the requested time.
