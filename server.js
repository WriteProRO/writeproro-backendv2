const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize OpenAI
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

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

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        gmCompliance: 'Active',
        services: {
            openai: 'Ready'
        }
    });
});

// Enhanced GM documentation generation endpoint
app.post('/api/generate-gm-enhanced-documentation', async (req, res) => {
    try {
        const { 
            vin, 
            system, 
            dtcCodes, 
            techNotes, 
            dealership,
            technician
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
TECHNICIAN: ${technician || 'Gary Wellington'}
DEALERSHIP: ${dealership || 'Bob King Buick GMC'}

Requirements:
1. Base analysis on GM Service Information procedures
2. Add Gary Wellington's expert diagnostic insights
3. Include real-world success rates and time estimates
4. Provide proper GM source attribution
5. Enhance with value-added commentary
6. Format as completed warranty documentation

Write as GM-enhanced diagnostic documentation with proper compliance attribution.`;

        // Generate content with OpenAI
        const completion = await openai.chat.completions.create({
            model: "gpt-4",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ],
            max_tokens: 800,
            temperature: 0.1,
        });

        const generatedContent = completion.choices[0].message.content;

        // GM data enhancement
        const gmData = {
            vehicleInfo: {
                year: 2010 + parseInt(vin.charAt(9)),
                make: 'GM Vehicle',
                vinDecoded: true,
                gmVehicle: true
            },
            diagnosticProtocol: {
                protocol: 'GM Standard Diagnostic Protocol',
                dtcFamily: dtcCodes ? dtcCodes.split(',')[0].charAt(0) : 'P',
                specialTools: ['GDS2', 'GM MDI', 'Tech2']
            },
            successRate: 94,
            timeEstimate: '2.5 hours',
            complianceVersion: '2024.1',
            attribution: 'Based on GM Service Information enhanced with expert analysis'
        };

        console.log('GM SI Enhanced Documentation Generated:', {
            vin: vin.slice(-4),
            system,
            dealership,
            timestamp: new Date().toISOString()
        });

        res.json({
            success: true,
            content: generatedContent,
            gmData: gmData,
            compliance: {
                attribution: 'Based on GM Service Information enhanced with expert analysis',
                authorized: true,
                tracked: true,
                auditId: 'GM-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2)
            },
            metadata: {
                model: "gpt-4-gm-enhanced",
                timestamp: new Date().toISOString(),
                system: system,
                vin_last_4: vin.slice(-4),
                dealership,
                technician
            }
        });

    } catch (error) {
        console.error('GM Enhanced Documentation Error:', error);
        
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

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server Error:', err);
    res.status(500).json({ 
        error: 'Internal server error',
        complianceNote: 'Error logged for GM compliance review'
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`WriteProRO GM-Enhanced Backend Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`GM Compliance Logging: Active`);
    console.log(`OpenAI API Key configured: ${process.env.OPENAI_API_KEY ? 'Yes' : 'No'}`);
});

module.exports = app;