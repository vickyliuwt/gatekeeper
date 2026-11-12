terraform {
  required_version = ">= 1.10, < 2.0"

  backend "s3" {
    key          = "gatekeeper/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }
}
