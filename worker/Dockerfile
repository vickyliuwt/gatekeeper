FROM public.ecr.aws/lambda/nodejs:22

# Dependencies first, so a code change does not reinstall them.
COPY worker/package.json worker/package-lock.json ${LAMBDA_TASK_ROOT}/
RUN npm ci --omit=dev

# Keep the repo layout inside the image so the import path is the same
# locally and in Lambda.
COPY sast/backend/scanner.js ${LAMBDA_TASK_ROOT}/sast/backend/
COPY worker/src/ ${LAMBDA_TASK_ROOT}/worker/src/

CMD [ "worker/src/handler.handler" ]