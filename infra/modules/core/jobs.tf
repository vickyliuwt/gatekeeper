resource "aws_dynamodb_table" "jobs" {
  name         = "gk-jobs"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "jobId"

  attribute {
    name = "jobId"
    type = "S"
  }

  attribute {
    name = "repo"
    type = "S"
  }

  attribute {
    name = "createdAt"
    type = "S"
  }

  global_secondary_index {
    name = "byRepoTime"

    key_schema {
      attribute_name = "repo"
      key_type       = "HASH"
    }

    key_schema {
      attribute_name = "createdAt"
      key_type       = "RANGE"
    }

    projection_type    = "INCLUDE"
    non_key_attributes = ["prNumber", "headSha", "phase", "verdict", "counts"]
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }
}

output "jobs_table_name" {
  value = aws_dynamodb_table.jobs.name
}
