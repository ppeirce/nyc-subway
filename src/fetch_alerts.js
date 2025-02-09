// src/fetch_alerts.js
import fs from 'fs/promises';
import path from 'path';

// Helper function to pretty print objects for logging
function formatForLog(obj) {
    return JSON.stringify(obj, null, 2);
}

async function getStoredAlerts() {
    console.log('Attempting to read stored alerts from data/last_check.json');
    try {
        const data = await fs.readFile('data/last_check.json', 'utf8');
        const parsedData = JSON.parse(data);
        console.log('Successfully read stored alerts:', formatForLog(parsedData));
        return parsedData;
    } catch (error) {
        console.log('No previous alerts found or error reading file:', error.message);
        return {};
    }
}

async function updateStoredAlerts(currentAlerts) {
    console.log('Updating stored alerts with:', formatForLog(currentAlerts));
    try {
        await fs.mkdir('data', { recursive: true });
        await fs.writeFile(
            'data/last_check.json',
            JSON.stringify(currentAlerts, null, 2)
        );
        console.log('Successfully wrote updated alerts to data/last_check.json');
    } catch (error) {
        console.error('Error writing alerts to file:', error);
        throw error;
    }
}

function getAlertDetails(alert) {
    console.log('\nExtracting details from alert:', alert.id);
    
    const alertData = alert.alert || {};
    console.log('Alert data structure:', formatForLog(alertData));
    
    // Get header text
    let headerText = null;
    const headerTranslations = alertData.header_text?.translation || [];
    console.log('Header translations:', formatForLog(headerTranslations));
    
    for (const translation of headerTranslations) {
        if (translation.language === 'en') {
            headerText = translation.text;
            break;
        }
    }
    
    // Get active period
    let activePeriod = null;
    const mercuryAlert = alertData['transit_realtime.mercury_alert'] || {};
    const periodTranslations = mercuryAlert.human_readable_active_period?.translation || [];
    console.log('Period translations:', formatForLog(periodTranslations));
    
    for (const translation of periodTranslations) {
        if (translation.language === 'en') {
            activePeriod = translation.text;
            break;
        }
    }
    
    console.log('Extracted details:', { headerText, activePeriod });
    return { headerText, activePeriod };
}

function filterSevenTrainAlerts(alertsData) {
    console.log('\nStarting to filter alerts for 7 train');
    console.log('Total alerts received:', alertsData.entity?.length || 0);
    
    const entities = alertsData.entity || [];
    const sevenTrainAlerts = entities.filter(entity => {
        const alert = entity.alert || {};
        const informedEntities = alert.informed_entity || [];
        
        // Log each entity we're checking
        console.log(`\nChecking alert ${entity.id}`);
        
        // Extract and log all sort_orders for this alert
        const sortOrders = informedEntities.map(informedEntity => {
            const mercurySelector = informedEntity['transit_realtime.mercury_entity_selector'] || {};
            return mercurySelector.sort_order;
        }).filter(Boolean);
        
        console.log('Sort orders found:', sortOrders);
        
        // Check if any informed entity has the 7 train sort order
        const isSevenTrain = informedEntities.some(informedEntity => {
            const mercurySelector = informedEntity['transit_realtime.mercury_entity_selector'] || {};
            return mercurySelector.sort_order === 'MTASBWY:7:20';
        });
        
        if (isSevenTrain) {
            console.log('Found 7 train alert:', entity.id);
        }
        
        return isSevenTrain;
    });
    
    console.log(`\nFiltering complete. Found ${sevenTrainAlerts.length} 7 train alerts`);
    return sevenTrainAlerts;
}

function compareAlerts(previousAlerts, currentAlerts) {
    console.log('\nComparing current alerts with previous alerts');
    console.log('Previous alerts:', formatForLog(previousAlerts));
    console.log('Current alerts:', formatForLog(currentAlerts));
    
    const newAlerts = [];
    const updatedAlerts = [];
    const unchangedAlerts = [];
    
    for (const [alertId, details] of Object.entries(currentAlerts)) {
        const { header, period } = details;
        
        if (!previousAlerts[alertId]) {
            console.log(`New alert found: ${alertId}`);
            newAlerts.push([alertId, header, period]);
        } else {
            const previous = previousAlerts[alertId];
            if (previous.header !== header || previous.period !== period) {
                console.log(`Updated alert found: ${alertId}`);
                updatedAlerts.push([alertId, header, period]);
            } else {
                console.log(`Unchanged alert found: ${alertId}`);
                unchangedAlerts.push([alertId, header, period]);
            }
        }
    }
    
    console.log('\nComparison results:');
    console.log(`New alerts: ${newAlerts.length}`);
    console.log(`Updated alerts: ${updatedAlerts.length}`);
    console.log(`Unchanged alerts: ${unchangedAlerts.length}`);
    
    return {
        newAlerts: newAlerts.sort(),
        updatedAlerts: updatedAlerts.sort(),
        unchangedAlerts: unchangedAlerts.sort()
    };
}

async function generateHTML(newAlerts, updatedAlerts, unchangedAlerts) {
    console.log('\nGenerating HTML page');
    
    const formatAlertSection = (title, alerts) => {
        if (!alerts.length) {
            console.log(`No alerts for section: ${title}`);
            return '';
        }
        
        console.log(`Generating section for: ${title} (${alerts.length} alerts)`);
        const alertsHtml = alerts.map(([_, header, period]) => `
            <div class="alert">
                <h3>${header}</h3>
                <p class="period">Active Period: ${period}</p>
            </div>
        `).join('\n');
        
        return `
            <section class="alert-section">
                <h2>${title}</h2>
                ${alertsHtml}
            </section>
        `;
    };
    
    try {
        console.log('Reading HTML template');
        const template = await fs.readFile('templates/page_template.html', 'utf8');
        
        const content = `
            ${formatAlertSection('New Alerts', newAlerts)}
            ${formatAlertSection('Updated Alerts', updatedAlerts)}
            ${formatAlertSection('Ongoing Alerts', unchangedAlerts)}
        `;
        
        const html = template
            .replace('{{CONTENT}}', content)
            .replace('{{LAST_UPDATED}}', new Date().toLocaleString());
        
        console.log('Writing generated HTML to index.html');
        await fs.writeFile('index.html', html);
        console.log('Successfully wrote HTML file');
    } catch (error) {
        console.error('Error generating HTML:', error);
        throw error;
    }
}

async function main() {
    console.log('\n=== Starting MTA Alert Check ===');
    console.log('Time:', new Date().toLocaleString());
    
    try {
        console.log('\nFetching MTA alerts...');
        const response = await fetch('https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fsubway-alerts.json');
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const alertsData = await response.json();
        console.log('Successfully fetched alerts from MTA API');
        console.log('First 500 characters of response:', JSON.stringify(alertsData).slice(0, 500));
        
        const sevenTrainAlerts = filterSevenTrainAlerts(alertsData);
        
        // Transform alerts into our format
        console.log('\nTransforming alerts into standard format');
        const currentAlerts = {};
        for (const alert of sevenTrainAlerts) {
            const { headerText, activePeriod } = getAlertDetails(alert);
            if (headerText && activePeriod) {
                currentAlerts[alert.id] = {
                    header: headerText,
                    period: activePeriod
                };
                console.log(`Processed alert ${alert.id}`);
            } else {
                console.log(`Skipping alert ${alert.id} - missing header or period`);
            }
        }
        
        // Compare with previous state
        const previousAlerts = await getStoredAlerts();
        const { newAlerts, updatedAlerts, unchangedAlerts } = compareAlerts(
            previousAlerts,
            currentAlerts
        );
        
        // Generate the HTML page
        await generateHTML(newAlerts, updatedAlerts, unchangedAlerts);
        
        // Store current state for next time
        await updateStoredAlerts(currentAlerts);
        
        console.log('\n=== Alert check completed successfully ===');
    } catch (error) {
        console.error('\nError updating alerts:', error);
        console.error('Stack trace:', error.stack);
        process.exit(1);
    }
}

export { main };
