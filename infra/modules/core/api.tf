variable "route_throttles" {
  description = "Throttle settings for individual HTTP API routes."
  type = list(object({
    route_key   = string
    rate_limit  = number
    burst_limit = number
  }))
  default = []
}

resource "aws_apigatewayv2_api" "gatekeeper" {
  name          = "gk-api"
  protocol_type = "HTTP"
}

resource "aws_cloudwatch_log_group" "api_access" {
  name              = "/gatekeeper/api/access"
  retention_in_days = 7
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.gatekeeper.id
  name        = "$default"
  auto_deploy = true

  dynamic "route_settings" {
    for_each = var.route_throttles
    content {
      route_key              = route_settings.value.route_key
      throttling_rate_limit  = route_settings.value.rate_limit
      throttling_burst_limit = route_settings.value.burst_limit
    }
  }

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_access.arn
    format = jsonencode({
      requestId = "$context.requestId"
      routeKey  = "$context.routeKey"
      status    = "$context.status"
      latencyMs = "$context.responseLatency"
      requestAt = "$context.requestTimeEpoch"
    })
  }
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
