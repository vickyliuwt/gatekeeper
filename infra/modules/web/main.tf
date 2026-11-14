# Part C module: gk-submit + gk-results (one image), logs, routes, alarm
locals {
  submit_name  = "gk-submit"
  results_name = "gk-results"

  common_env = {
    JOBS_TABLE_NAME  = var.jobs_table_name
    DATA_BUCKET_NAME = var.data_bucket_name
  }

  results_routes = {
    page   = "GET /"
    list   = "GET /scans"
    status = "GET /scans/{jobId}"
    report = "GET /scans/{jobId}/report"
  }
}

# log groups made by Terraform, so destroy removes them too
resource "aws_cloudwatch_log_group" "submit" {
  name              = "/aws/lambda/${local.submit_name}"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "results" {
  name              = "/aws/lambda/${local.results_name}"
  retention_in_days = var.log_retention_days
}

# gk-submit: POST /scans, writes only
resource "aws_lambda_function" "submit" {
  function_name = local.submit_name
  description   = "Part C: POST /scans saves pasted code to S3, creates the job and queues it."
  package_type  = "Image"
  image_uri     = var.image_uri
  role          = var.submit_role_arn
  architectures = ["x86_64"]
  memory_size   = 256
  timeout       = 10

  image_config {
    command = ["src/lambda.submitHandler"]
  }

  environment {
    variables = merge(local.common_env, {
      JOBS_QUEUE_URL  = var.jobs_queue_url
      DEMO_CODE_PARAM = var.demo_code_param
    })
  }

  depends_on = [aws_cloudwatch_log_group.submit]
}

# gk-results: the 4 GET routes, read only (default CMD of the image)
resource "aws_lambda_function" "results" {
  function_name = local.results_name
  description   = "Part C: GET / serves the page; GET /scans routes read jobs and reports. Read only."
  package_type  = "Image"
  image_uri     = var.image_uri
  role          = var.results_role_arn
  architectures = ["x86_64"]
  memory_size   = 256
  timeout       = 10

  image_config {
    command = ["src/lambda.resultsHandler"]
  }

  environment {
    variables = merge(local.common_env, {
      ALLOWED_REPO = var.list_repo
    })
  }

  depends_on = [aws_cloudwatch_log_group.results]
}

# API Gateway -> Lambda (payload 2.0)
resource "aws_apigatewayv2_integration" "submit" {
  api_id                 = var.api_id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.submit.invoke_arn
  integration_method     = "POST"
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_integration" "results" {
  api_id                 = var.api_id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.results.invoke_arn
  integration_method     = "POST"
  payload_format_version = "2.0"
}

# only this API may call gk-submit, and only POST /scans
resource "aws_lambda_permission" "submit_api" {
  statement_id  = "AllowSubmitRoute"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.submit.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${var.api_execution_arn}/$default/POST/scans"
}

# only GET routes of this API may call gk-results ("GET*" also covers GET /)
resource "aws_lambda_permission" "results_api" {
  statement_id  = "AllowResultsGetRoutes"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.results.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${var.api_execution_arn}/$default/GET*"
}

# the 5 Part C routes: 1 POST + 4 GET. any other path gets 404
resource "aws_apigatewayv2_route" "submit" {
  api_id    = var.api_id
  route_key = "POST /scans"
  target    = "integrations/${aws_apigatewayv2_integration.submit.id}"

  depends_on = [aws_lambda_permission.submit_api]
}

resource "aws_apigatewayv2_route" "results" {
  for_each = local.results_routes

  api_id    = var.api_id
  route_key = each.value
  target    = "integrations/${aws_apigatewayv2_integration.results.id}"

  depends_on = [aws_lambda_permission.results_api]
}

# alarm: first Lambda error fires it, 5 clean min clear it (1 problem = 1 email)
# normal 4xx/5xx JSON replies are not Lambda errors, so an alarm here = a real bug
resource "aws_cloudwatch_metric_alarm" "web_errors" {
  count = var.enable_alarm ? 1 : 0

  alarm_name          = "gk-web-errors"
  alarm_description   = "gk-submit or gk-results had a Lambda error in 1 of the last 5 minutes. It stays in ALARM until 5 clean minutes, so one problem sends one email."
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 5
  datapoints_to_alarm = 1
  threshold           = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = var.alarm_topic_arn == null ? [] : [var.alarm_topic_arn]

  metric_query {
    id          = "errors"
    expression  = "FILL(submit, 0) + FILL(results, 0)"
    label       = "Web Lambda errors"
    return_data = true
  }

  metric_query {
    id = "submit"

    metric {
      namespace   = "AWS/Lambda"
      metric_name = "Errors"
      period      = 60
      stat        = "Sum"
      dimensions  = { FunctionName = aws_lambda_function.submit.function_name }
    }
  }

  metric_query {
    id = "results"

    metric {
      namespace   = "AWS/Lambda"
      metric_name = "Errors"
      period      = 60
      stat        = "Sum"
      dimensions  = { FunctionName = aws_lambda_function.results.function_name }
    }
  }
}
