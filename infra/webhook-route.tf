resource "aws_apigatewayv2_integration" "webhook" {
  count = var.enable_intake ? 1 : 0

  api_id                 = module.core.api_id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.webhook[0].invoke_arn
  integration_method     = "POST"
  payload_format_version = "2.0"
}

resource "aws_lambda_permission" "webhook_api" {
  count = var.enable_intake ? 1 : 0

  statement_id  = "AllowWebhookRoute"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.webhook[0].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${module.core.api_execution_arn}/$default/POST/webhooks/github"
}

resource "aws_apigatewayv2_route" "webhook" {
  count = var.enable_intake ? 1 : 0

  api_id    = module.core.api_id
  route_key = "POST /webhooks/github"
  target    = "integrations/${aws_apigatewayv2_integration.webhook[0].id}"

  depends_on = [aws_lambda_permission.webhook_api]
}

# Part A's per-route limit, plugged into module.core by infra/core.tf. route_key comes from the
# route itself, so the stage waits until the route exists.
locals {
  intake_route_throttles = [for route in aws_apigatewayv2_route.webhook : {
    route_key   = route.route_key
    rate_limit  = 10
    burst_limit = 25
  }]
}

output "webhook_url" {
  value = var.enable_intake ? "${module.core.api_endpoint}/webhooks/github" : null
}

# enable_intake added count. Keep Part A's existing integration, permission and route.
moved {
  from = aws_apigatewayv2_integration.webhook
  to   = aws_apigatewayv2_integration.webhook[0]
}

moved {
  from = aws_lambda_permission.webhook_api
  to   = aws_lambda_permission.webhook_api[0]
}

moved {
  from = aws_apigatewayv2_route.webhook
  to   = aws_apigatewayv2_route.webhook[0]
}
