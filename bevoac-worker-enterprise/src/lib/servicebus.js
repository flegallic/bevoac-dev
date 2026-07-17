const { DefaultAzureCredential } = require('@azure/identity');
const { ServiceBusClient } = require('@azure/service-bus');

function buildServiceBusClient(config) {
  if (config.serviceBus.authMode === 'managed_identity') {
    return new ServiceBusClient(config.serviceBus.fullyQualifiedNamespace, new DefaultAzureCredential());
  }
  return new ServiceBusClient(config.serviceBus.connectionString);
}

module.exports = { buildServiceBusClient };
