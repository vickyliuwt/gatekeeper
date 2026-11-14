# gatekeeper/web image: one image, two Lambda functions
# gk-results uses the CMD below, gk-submit gets its own command from Terraform
# local build (in services/web):
#   docker buildx build --platform linux/amd64 --provenance=false -t gk-web:local --load .
FROM public.ecr.aws/lambda/nodejs:22

WORKDIR ${LAMBDA_TASK_ROOT}

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src/ ./src/
COPY public/ ./public/

CMD ["src/lambda.resultsHandler"]
