# the web image
# one image for two lambda functions
# the results lambda uses the CMD below
# the submit lambda gets its own command from Terraform
# local build from the web folder
# build for linux amd64 and turn provenance off
# the deploy script does the same
FROM public.ecr.aws/lambda/nodejs:22

WORKDIR ${LAMBDA_TASK_ROOT}

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src/ ./src/
COPY public/ ./public/

CMD ["src/lambda.resultsHandler"]
