terraform {
  required_version = ">= 1.6.0"

  backend "azurerm" {
    storage_account_name = "stbevoacprodtfstate"
    container_name       = "tfstate"
    key                  = "bevoac-prod.tfstate"
    subscription_id      = "1f75d3e8-9e7c-4900-815c-44822cb9be01"
    tenant_id            = "eebbcba2-8fa7-41fc-9193-77cf53650e76"
    use_azuread_auth     = true
  }

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.67"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.7"
    }
    time = {
      source  = "hashicorp/time"
      version = "~> 0.12"
    }
  }
}
