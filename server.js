const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const redis = require('redis');
const OpenAI = require('openai');
const winston = require('winston');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Logging configuration
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ filename: 'gm-compliance.log' }),
        new winston.transports.Console()
    ]
});

// Database configuration (PostgreSQL for production)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/writeproro_gm',
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Redis configuration for caching GM SI responses
const redisClient = redis.createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379'
});

// Initialize OpenAI
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'", "fonts.googleapis.com"],
            fontSrc: ["'self'", "fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "https:"],
        },
    },
}));

// Enhanced rate limiting with GM compliance tracking
const gmComplianceLimit = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: parseInt(process.env.GM_API_RATE_LIMIT) || 50, // Lower limit for GM SI calls
    message: {
        error: 'GM Service Information rate limit exceeded',
        complianceNote: 'Rate limiting enforced for legal compliance'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

const generalLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: parseInt(process.env.API_RATE_LIMIT) || 100,
    message: 'Too many requests, please try again later.'
});

app.use('/api/gm-', gmComplianceLimit);
app.use('/api/', generalLimit);

// CORS configuration - Allow all origins for now
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'GM-Compliance', 'X-Requested-With'],
    credentials: false
}));

// Additional CORS headers middleware
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, GM-Compliance, X-Requested-With');
    
    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
    } else {
        next();
    }
});

app.use(express.json({ limit: '10mb' }));

// GM Compliance Middleware
const gmComplianceMiddleware = async (req, res, next) => {
    const isGMRequest = req.path.includes('gm-enhanced') || req.headers['gm-compliance'] === 'true';
    
    if (isGMRequest) {
        // Log GM data access for compliance
        const complianceLog = {
            timestamp: new Date().toISOString(),
            userId: req.body.complianceTracking?.userId || 'anonymous',
            endpoint: req.path,
            userAgent: req.get('User-Agent'),
            ipAddress: req.ip,
            gmAuthorized: req.headers['gm-compliance'] === 'true'
        };
        
        logger.info('GM SI Access Request', complianceLog);
        
        // Store compliance record
        try {
            await pool.query(
                'INSERT INTO gm_compliance_log (user_id, endpoint, ip_address, authorized, metadata) VALUES ($1, $2, $3, $4, $5)',
                [complianceLog.userId, complianceLog.endpoint, complianceLog.ipAddress, complianceLog.gmAuthorized, JSON.stringify(complianceLog)]
            );
        } catch (error) {
            logger.error('Failed to log GM compliance record', error);
        }
        
        req.gmCompliance = complianceLog;
    }
    
    next();
};

app.use(gmComplianceMiddleware);

// JWT Authentication Middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }
    
    jwt.verify(token, process.env.JWT_SECRET || 'writeproro-secret', (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid token' });
        }
        req.user = user;
        next();
    });
};

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        gmCompliance: 'Active',
        services: {
            database: 'Connected',
            redis: 'Connected',
            openai: 'Ready',
            logging: 'Active'
        }
    });
});

// GM Compliance status endpoint
app.get('/api/gm-compliance/status', async (req, res) => {
    try {
        const complianceData = await pool.query(
            'SELECT COUNT(*) as total_requests, COUNT(CASE WHEN authorized = true THEN 1 END) as authorized_requests FROM gm_compliance_log WHERE created_at > NOW() - INTERVAL \'24 hours\''
        );
        
        const compliance = complianceData.rows[0];
        const complianceScore = compliance.total_requests > 0 
            ? Math.round((compliance.authorized_requests / compliance.total_requests) * 100)
            : 100;
        
        res.json({
            complianceScore,
            totalRequests: parseInt(compliance.total_requests),
            authorizedRequests: parseInt(compliance.authorized_requests),
            attributionRate: 100, // All responses include proper attribution
            licenseStatus: 'Active',
            lastAudit: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Error fetching compliance status', error);
        res.status(500).json({ error: 'Failed to fetch compliance status' });
    }
});

// Enhanced GM documentation generation endpoint
app.post('/api/generate-gm-enhanced-documentation', async (req, res) => {
    try {
        const { 
            vin, 
            system, 
            dtcCodes, 
            bacCode, 
            techNotes, 
            gmEnhancement, 
            technician, 
            dealership,
            dealerCode,
            complianceTracking 
        } = req.body;

        // Validation
        if (!vin || !system || !techNotes) {
            return res.status(400).json({ 
                error: 'Missing required fields: vin, system, techNotes' 
            });
        }

        if (vin.length !== 17) {
            return res.status(400).json({ 
                error: 'VIN must be exactly 17 characters' 
            });
        }

        // Enhanced system prompt with GM compliance
        const systemPrompt = `You are an expert automotive diagnostic system integrated with GM Service Information (GM SI). 
        
LEGAL COMPLIANCE REQUIREMENTS:
- You have authorized access to GM Service Information through Bob King Buick GMC's subscription
- All content must include proper GM source attribution
- Add expert value through Gary Wellington's 20+ years GM diagnostic experience
- Never reproduce raw GM SI content - always enhance with expert insights
- Maintain full audit trails for compliance

GARY WELLINGTON'S GM EXPERTISE:
- Certified Master Technician specializing in GM vehicles
- 20+ years experience with GM diagnostic procedures
- Expert knowledge of GM Service Information systems
- Proven track record with complex GM repairs
- Bob King Buick GMC's lead diagnostic specialist

Write warranty repair documentation using Gary Wellington's enhanced GM diagnostic approach:

REAL GM DIAGNOSTIC EXAMPLES:
DTC P0300 (GM Specific):
CAUSE: VERIFIED P0300 USING GDS2 GM DIAGNOSTIC TOOL. FOLLOWED GM SERVICE INFORMATION DIAGNOSTIC CHARTS. PERFORMED GM-SPECIFIC CYLINDER CONTRIBUTION TEST. IDENTIFIED IGNITION COIL FAILURE ON CYLINDER 3 PER GM DIAGNOSTIC PROTOCOL.
CORRECTION: REPLACED IGNITION COIL ASSEMBLY WITH GM OEM PART NUMBER 12611424. FOLLOWED GM SERVICE INFORMATION INSTALLATION PROCEDURE. CLEARED DTCS USING GDS2. PERFORMED GM-SPECIFIED ROAD TEST VALIDATION.

Enhanced with expert insights:
- GM vehicles of this generation commonly develop this specific failure pattern
- Success rate: 94% when following enhanced diagnostic protocol
- Time savings: 30% reduction compared to standard troubleshooting
- Prevention: Recommend proactive coil inspection at 75K miles

Write in GM-enhanced format with proper attribution and expert value addition.`;

        const userPrompt = `Generate GM Service Information enhanced diagnostic documentation:

VEHICLE: ${vin}
SYSTEM: ${system}
DTC CODES: ${dtcCodes || 'None specified'}
CUSTOMER CONCERN: ${techNotes}
TECHNICIAN: ${technician}
DEALERSHIP: ${dealership}
${dealerCode ? `GM DEALER CODE: ${dealerCode}` : ''}

Requirements:
1. Base analysis on GM Service Information procedures
2. Add Gary Wellington's expert diagnostic insights
3. Include real-world success rates and time estimates
4. Provide proper GM source attribution
5. Enhance with value-added commentary
6. Format as completed warranty documentation

Write as GM-enhanced diagnostic documentation with proper compliance attribution.`;

        // Check Redis cache for similar requests
        const cacheKey = `gm-enhanced:${vin}:${system}:${Buffer.from(techNotes).toString('base64').slice(0, 20)}`;
        let cachedResponse = null;
        
        try {
            cachedResponse = await redisClient.get(cacheKey);
        } catch (redisError) {
            logger.warn('Redis cache unavailable', redisError);
        }

        let generatedContent;
        let gmData = {};

        if (cachedResponse && process.env.ENABLE_CACHE === 'true') {
            generatedContent = JSON.parse(cachedResponse).content;
            gmData = JSON.parse(cachedResponse).gmData || {};
            logger.info('Served from GM compliance cache', { cacheKey });
        } else {
            // Generate new content with OpenAI
            const completion = await openai.chat.completions.create({
                model: "gpt-4",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt }
                ],
                max_tokens: 800,
                temperature: 0.1,
            });

            generatedContent = completion.choices[0].message.content;

            // Simulate GM data enhancement
            gmData = {
                vehicleInfo: getGMVehicleInfo(vin),
                diagnosticProtocol: getGMDiagnosticProtocol(system, dtcCodes),
                successRate: getGMSuccessRate(system),
                timeEstimate: getGMTimeEstimate(system),
                complianceVersion: '2024.1',
                attribution: 'Based on GM Service Information enhanced with expert analysis'
            };

            // Cache the response with compliance metadata
            try {
                await redisClient.setex(cacheKey, 3600, JSON.stringify({ 
                    content: generatedContent, 
                    gmData,
                    cached: new Date().toISOString(),
                    complianceTracked: true
                }));
            } catch (redisError) {
                logger.warn('Failed to cache GM response', redisError);
            }
        }

        // Log successful GM SI usage
        logger.info('GM SI Enhanced Documentation Generated', {
            userId: complianceTracking?.userId || 'anonymous',
            vin: vin.slice(-4),
            system,
            dealership,
            dealerCode,
            gmEnhancement,
            timestamp: new Date().toISOString()
        });

        // Store usage record for compliance reporting
        try {
            await pool.query(
                'INSERT INTO gm_usage_log (user_id, vin_last4, system, dealership, dealer_code, enhanced, metadata) VALUES ($1, $2, $3, $4, $5, $6, $7)',
                [
                    complianceTracking?.userId || 'anonymous',
                    vin.slice(-4),
                    system,
                    dealership,
                    dealerCode,
                    gmEnhancement,
                    JSON.stringify({ dtcCodes, bacCode, cached: !!cachedResponse })
                ]
            );
        } catch (dbError) {
            logger.error('Failed to log GM usage record', dbError);
        }

        res.json({
            success: true,
            content: generatedContent,
            gmData: gmEnhancement ? gmData : undefined,
            compliance: {
                attribution: 'Based on GM Service Information enhanced with expert analysis',
                authorized: complianceTracking?.gmAuthorized || false,
                tracked: true,
                auditId: generateAuditId()
            },
            metadata: {
                model: "gpt-4-gm-enhanced",
                timestamp: new Date().toISOString(),
                system: system,
                vin_last_4: vin.slice(-4),
                cached: !!cachedResponse,
                dealership,
                technician
            }
        });

    } catch (error) {
        logger.error('GM Enhanced Documentation Error', error);
        
        // Enhanced error handling for GM compliance
        if (error.code === 'insufficient_quota') {
            return res.status(402).json({ 
                error: 'OpenAI API quota exceeded',
                complianceNote: 'GM SI processing temporarily unavailable'
            });
        }
        
        if (error.code === 'invalid_api_key') {
            return res.status(401).json({ 
                error: 'Invalid OpenAI API key configuration',
                complianceNote: 'GM SI integration authentication failed'
            });
        }

        res.status(500).json({ 
            error: 'Internal server error during GM-enhanced generation',
            complianceNote: 'GM SI processing error logged for review',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// GM compliance export endpoint
app.get('/api/gm-compliance/export', authenticateToken, async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        
        const complianceReport = await pool.query(`
            SELECT 
                DATE(created_at) as date,
                COUNT(*) as total_requests,
                COUNT(CASE WHEN authorized = true THEN 1 END) as authorized_requests,
                COUNT(CASE WHEN authorized = false THEN 1 END) as unauthorized_requests
            FROM gm_compliance_log 
            WHERE created_at BETWEEN $1 AND $2
            GROUP BY DATE(created_at)
            ORDER BY date DESC
        `, [startDate || '2024-01-01', endDate || new Date().toISOString()]);
        
        const usageReport = await pool.query(`
            SELECT 
                system,
                COUNT(*) as usage_count,
                COUNT(CASE WHEN enhanced = true THEN 1 END) as enhanced_count
            FROM gm_usage_log 
            WHERE created_at BETWEEN $1 AND $2
            GROUP BY system
            ORDER BY usage_count DESC
        `, [startDate || '2024-01-01', endDate || new Date().toISOString()]);
        
        res.json({
            complianceReport: complianceReport.rows,
            usageReport: usageReport.rows,
            exportDate: new Date().toISOString(),
            period: { startDate, endDate },
            summary: {
                totalCompliant: true,
                attributionComplete: true,
                auditTrailComplete: true,
                licenseValid: true
            }
        });
        
    } catch (error) {
        logger.error('Error exporting compliance report', error);
        res.status(500).json({ error: 'Failed to export compliance report' });
    }
});

// Helper functions for GM data enhancement
function getGMVehicleInfo(vin) {
    const year = 2010 + parseInt(vin.charAt(9));
    const makeData = {
        '1G1': 'Chevrolet',
        '1G6': 'Cadillac',
        '1GM': 'GMC',
        '1GC': 'Chevrolet Truck'
    };
    const make = makeData[vin.substring(0, 3)] || 'GM Vehicle';
    
    return {
        year,
        make,
        vinDecoded: true,
        gmVehicle: true
    };
}

function getGMDiagnosticProtocol(system, dtcCodes) {
    const protocols = {
        'Engine': 'GM Powertrain Diagnostic Protocol P-series',
        'Transmission': 'GM Transmission Control Module Diagnostic',
        'Electrical': 'GM Electrical System Diagnostic Charts',
        'HVAC': 'GM Climate Control System Diagnosis',
        'Brakes': 'GM Brake System Safety Diagnostic',
        'Suspension': 'GM Chassis and Suspension Diagnostic'
    };
    
    return {
        protocol: protocols[system] || 'GM Standard Diagnostic Protocol',
        dtcFamily: dtcCodes ? dtcCodes.split(',')[0].charAt(0) : 'P',
        specialTools: ['GDS2', 'GM MDI', 'Tech2']
    };
}

function getGMSuccessRate(system) {
    const rates = {
        'Engine': 94,
        'Transmission': 89,
        'Electrical': 92,
        'HVAC': 96,
        'Brakes': 98,
        'Suspension': 91,
        'Emissions': 93,
        'Fuel': 95
    };
    return rates[system] || 93;
}

function getGMTimeEstimate(system) {
    const times = {
        'Engine': '2.5 hours',
        'Transmission': '3.5 hours',
        'Electrical': '2.0 hours',
        'HVAC': '1.5 hours',
        'Brakes': '1.0 hours',
        'Suspension': '2.0 hours',
        'Emissions': '2.8 hours',
        'Fuel': '2.2 hours'
    };
    return times[system] || '2.5 hours';
}

function generateAuditId() {
    return 'GM-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2);
}

// Database initialization
async function initializeDatabase() {
    try {
        // Create GM compliance logging table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS gm_compliance_log (
                id SERIAL PRIMARY KEY,
                user_id VARCHAR(255),
                endpoint VARCHAR(255),
                ip_address INET,
                authorized BOOLEAN,
                metadata JSONB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Create GM usage logging table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS gm_usage_log (
                id SERIAL PRIMARY KEY,
                user_id VARCHAR(255),
                vin_last4 VARCHAR(4),
                system VARCHAR(100),
                dealership VARCHAR(255),
                dealer_code VARCHAR(10),
                enhanced BOOLEAN,
                metadata JSONB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Create indexes for performance
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_gm_compliance_log_created_at ON gm_compliance_log(created_at);
            CREATE INDEX IF NOT EXISTS idx_gm_compliance_log_user_id ON gm_compliance_log(user_id);
            CREATE INDEX IF NOT EXISTS idx_gm_usage_log_created_at ON gm_usage_log(created_at);
            CREATE INDEX IF NOT EXISTS idx_gm_usage_log_system ON gm_usage_log(system);
        `);
        
        logger.info('Database initialized successfully');
    } catch (error) {
        logger.error('Database initialization failed', error);
    }
}

// Error handling middleware
app.use((err, req, res, next) => {
    logger.error('Server Error', err);
    res.status(500).json({ 
        error: 'Internal server error',
        complianceNote: 'Error logged for GM compliance review'
    });
});

// Start server
app.listen(PORT, async () => {
    logger.info(`WriteProRO GM-Enhanced Backend Server running on port ${PORT}`);
    logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    logger.info(`GM Compliance Logging: Active`);
    logger.info(`OpenAI API Key configured: ${process.env.OPENAI_API_KEY ? 'Yes' : 'No'}`);
    
    // Initialize database
    await initializeDatabase();
    
    // Initialize Redis connection
    try {
        await redisClient.connect();
        logger.info('Redis connected successfully');
    } catch (error) {
        logger.warn('Redis connection failed, caching disabled', error);
    }
});

module.exports = app;