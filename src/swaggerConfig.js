const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'PricePing Admin API',
      version: '1.0.0',
      description: 'Admin API documentation for PricePing WhatsApp Bot - Real-time monitoring and management interface',
      contact: {
        name: 'PricePing Team',
        email: 'admin@priceping.com'
      }
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Development server'
      },
      {
        url: 'https://your-production-url.com',
        description: 'Production server'
      }
    ],
    components: {
      schemas: {
        BotStatus: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: ['online', 'offline'],
              description: 'Current bot status'
            },
            uptime: {
              type: 'number',
              description: 'Bot uptime in seconds'
            },
            version: {
              type: 'string',
              description: 'Bot version'
            }
          }
        },
        WhatsAppStatus: {
          type: 'object',
          properties: {
            connected: {
              type: 'boolean',
              description: 'WhatsApp connection status'
            },
            hasSession: {
              type: 'boolean',
              description: 'Whether session exists'
            }
          }
        },
        UserStats: {
          type: 'object',
          properties: {
            total: {
              type: 'integer',
              description: 'Total number of users'
            },
            new24h: {
              type: 'integer',
              description: 'New users in last 24 hours'
            },
            activeUsers: {
              type: 'integer',
              description: 'Active users (created alerts in last 24h)'
            },
            pro: {
              type: 'integer',
              description: 'Number of pro users'
            },
            weeklyGrowth: {
              type: 'integer',
              description: 'Weekly growth percentage'
            },
            dailyNew: {
              type: 'array',
              items: { type: 'integer' },
              description: 'Daily new users for last 7 days'
            }
          }
        },
        AlertStats: {
          type: 'object',
          properties: {
            active: {
              type: 'integer',
              description: 'Number of active alerts'
            },
            totalToday: {
              type: 'integer',
              description: 'Total alerts created today'
            },
            totalAllTime: {
              type: 'integer',
              description: 'Total alerts created all time'
            },
            deliverySuccess: {
              type: 'integer',
              description: 'Delivery success percentage'
            },
            avgLatency: {
              type: 'integer',
              description: 'Average processing latency in ms'
            }
          }
        },
        AlertFeedItem: {
          type: 'object',
          properties: {
            timestamp: { type: 'string', format: 'date-time' },
            symbol: { type: 'string' },
            condition: { type: 'string' },
            user: { type: 'string' },
            status: { type: 'string' }
          }
        },
        ExternalApiStatus: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            status: { type: 'string' },
            latency: { type: 'string' }
          }
        },
        SystemStats: {
          type: 'object',
          properties: {
            memory: {
              type: 'object',
              properties: {
                rss: { type: 'integer', description: 'RSS memory in bytes' },
                heapUsed: { type: 'integer', description: 'Heap used in bytes' },
                limit: { type: 'integer', description: 'Memory limit in bytes' },
                percentage: { type: 'integer', description: 'Memory usage percentage' }
              }
            },
            cpu: {
              type: 'object',
              properties: {
                percentage: { type: 'integer', description: 'CPU usage percentage' }
              }
            },
            health: {
              type: 'integer',
              description: 'Overall system health score (0-100)'
            }
          }
        },
        UserInfo: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'User ID' },
            phone: { type: 'string', description: 'Phone number' },
            name: { type: 'string', description: 'User name' },
            subscription: { type: 'string', enum: ['free', 'pro'], description: 'Subscription type' },
            alertsUsed: { type: 'integer', description: 'Alerts used this period' },
            joined: { type: 'string', format: 'date-time', description: 'Registration date' },
            lastActive: { type: 'string', format: 'date-time', description: 'Last activity date' }
          }
        },
        AlertInfo: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Alert ID' },
            asset: { type: 'string', description: 'Asset symbol' },
            targetPrice: { type: 'number', description: 'Target price' },
            direction: { type: 'string', enum: ['above', 'below'], description: 'Alert direction' },
            user: { type: 'string', description: 'User phone number' },
            created: { type: 'string', format: 'date-time', description: 'Creation date' },
            status: { type: 'string', description: 'Alert status' }
          }
        },
        Activity: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Activity ID' },
            type: { type: 'string', enum: ['user', 'alert', 'subscription'], description: 'Activity type' },
            title: { type: 'string', description: 'Activity title' },
            description: { type: 'string', description: 'Activity description' },
            timestamp: { type: 'string', format: 'date-time', description: 'Activity timestamp' },
            level: { type: 'string', enum: ['info', 'success', 'warning'], description: 'Activity level' },
            timeAgo: { type: 'string', description: 'Human readable time ago' }
          }
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            error: { type: 'string', description: 'Error message' }
          }
        }
      }
    }
  },
  apis: ['./src/adminAPI.js'], // Path to the API docs
};

const specs = swaggerJsdoc(options);

module.exports = specs;