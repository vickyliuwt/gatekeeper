resource "aws_apigatewayv2_integration" "webhook" {
  api_id                 = module.core.api_id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.webhook.invoke_arn
  integration_method     = "POST"
  payload_format_version = "2.0"
}

resource "aws_lambda_permission" "webhook_api" {
  statement_id  = "AllowWebhookRoute"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.webhook.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${module.core.api_execution_arn}/$default/POST/webhooks/github"
}

resource "aws_apigatewayv2_route" "webhook" {
  api_id    = module.core.api_id
  route_key = "POST /webhooks/github"
  target    = "integrations/${aws_apigatewayv2_integration.webhook.id}"

  depends_on = [aws_lambda_permission.webhook_api]
}

output "webhook_url" {
  value = "${module.core.api_endpoint}/webhooks/github"
}
