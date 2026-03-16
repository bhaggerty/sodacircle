# ECS deployment notes

This project is containerized for ECS using the root `Dockerfile`.

## Container settings

- Container port: `3000`
- Health check path: `/`
- Start command: `node server.js`
- Runtime image source: Docker build from the repo root

## Recommended ECS task settings

- Launch type: `Fargate`
- CPU: `512`
- Memory: `1024`
- Desired count: `1` for prototype environments

## Required environment variables

Use the values in `.env.example` as the baseline.

Minimum runtime env:

- `NODE_ENV=production`
- `PORT=3000`
- `HOSTNAME=0.0.0.0`
- `AWS_REGION=<your-region>`
- `APP_URL=<public-app-url>`

Recommended DynamoDB env:

- `DYNAMODB_TABLE_JOBS`
- `DYNAMODB_TABLE_CANDIDATES`
- `DYNAMODB_TABLE_JOB_CANDIDATES`
- `DYNAMODB_TABLE_MESSAGES`
- `DYNAMODB_TABLE_FEEDBACK`

## IAM permissions

The ECS task role should be able to access the DynamoDB tables used by the app.

At minimum, grant:

- `dynamodb:GetItem`
- `dynamodb:PutItem`
- `dynamodb:UpdateItem`
- `dynamodb:DeleteItem`
- `dynamodb:Query`
- `dynamodb:Scan`

Scope those permissions to the specific `sodacircle` tables for the environment.

## Union Station notes

I was not able to verify an official Union Station config file format from available sources, so this repo does not include a guessed Union Station YAML file.

Use these values in your Union Station ECS service configuration:

- Build context: repo root
- Dockerfile path: `Dockerfile`
- Container port: `3000`
- Health check path: `/`
- Start command: default image command
- Environment variables: from `.env.example`

## Suggested AWS resource naming

- `sodacircle-web`
- `sodacircle-jobs`
- `sodacircle-candidates`
- `sodacircle-job-candidates`
- `sodacircle-messages`
- `sodacircle-feedback`
