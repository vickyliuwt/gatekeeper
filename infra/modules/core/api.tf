resource "aws_apigatewayv2_api" "gatekeeper" {
  name          = "gk-api"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.gatekeeper.id
  name        = "$default"
  auto_deploy = true
}

output "api_id" {
  value = aws_apigatewayv2_api.gatekeeper.id
}

output "api_endpoint" {
  value = aws_apigatewayv2_api.gatekeeper.api_endpoint
}

output "api_execution_arn" {
  value = aws_apigatewayv2_api.gatekeeper.execution_arn
}
