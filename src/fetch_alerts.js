// src/fetch_alerts.js
import fs from 'fs/promises';
import path from 'path';

async function getStoredAlerts() {
    try {
        const data = await fs.readFile('data/last_check.json', 'utf8');
        return JSON.parse(data);
    } catch (error) {
        // If file doesn't exist or is invalid, return empty object
        return {};
    }
}

async function updateStoredAlerts(currentAlerts) {
    await fs.mkdir('data', { recursive: true });
    await fs.writeFile(
        'data/last_check.json',
        JSON.stringify(currentAlerts, null, 2)
    );
}

function getAlertDetails(alert) {
    const alertData = alert.alert || {};
    
    // Get header text
    let headerText = null;
    const headerTranslations = alertData.header_text?.translation || [];
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
    for (const translation of periodTranslations) {
        if (translation.language === 'en') {
            activePeriod = translation.text;
            break;
        }
    }
    
    return { headerText, activePeriod };
}

function filterSevenTrainAlerts(alertsData) {
    const entities = alertsData.entity || [];
    return entities.filter(entity => {
        const alert = entity.alert || {};
        const informedEntities = alert.informed_entity || [];
        
        return informedEntities.some(informedEntity => {
            const mercurySelector = informedEntity['transit_realtime.mercury_entity_selector'] || {};
            return mercurySelector.sort_order === 'MTASBWY:7:20';
        });
    });
}

function compareAlerts(previousAlerts, currentAlerts) {
    const newAlerts = [];
    const updatedAlerts = [];
    const unchangedAlerts = [];
    
    for (const [alertId, details] of Object.entries(currentAlerts)) {
        const { header, period } = details;
        
        if (!previousAlerts[alertId]) {
            newAlerts.push([alertId, header, period]);
        } else {
            const previous = previousAlerts[alertId];
            if (previous.header !== header || previous.period !== period) {
                updatedAlerts.push([alertId, header, period]);
            } else {
                unchangedAlerts.push([alertId, header, period]);
            }
        }
    }
    
    return {
        newAlerts: newAlerts.sort(),
        updatedAlerts: updatedAlerts.sort(),
        unchangedAlerts: unchangedAlerts.sort()
    };
}

async function generateHTML(newAlerts, updatedAlerts, unchangedAlerts) {
    const formatAlertSection = (title, alerts) => {
        if (!alerts.length) return '';
        
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
    
    const template = await fs.readFile('templates/page_template.html', 'utf8');
    const content = `
        ${formatAlertSection('New Alerts', newAlerts)}
        ${formatAlertSection('Updated Alerts', updatedAlerts)}
        ${formatAlertSection('Ongoing Alerts', unchangedAlerts)}
    `;
    
    const html = template
        .replace('{{CONTENT}}', content)
        .replace('{{LAST_UPDATED}}', new Date().toLocaleString());
    
    await fs.writeFile('index.html', html);
}

async function main() {
    try {
        console.log('Fetching MTA alerts...');
        const response = await fetch('https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fsubway-alerts.json');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const alertsData = await response.json();
        const sevenTrainAlerts = filterSevenTrainAlerts(alertsData);
        console.log(`Found ${sevenTrainAlerts.length} alerts for the 7 train`);
        
        // Transform alerts into our format
        const currentAlerts = {};
        for (const alert of sevenTrainAlerts) {
            const { headerText, activePeriod } = getAlertDetails(alert);
            if (headerText && activePeriod) {
                currentAlerts[alert.id] = {
                    header: headerText,
                    period: activePeriod
                };
            }
        }
        
        // Compare with previous state
        const previousAlerts = await getStoredAlerts();
        const { newAlerts, updatedAlerts, unchangedAlerts } = compareAlerts(
            previousAlerts,
            currentAlerts
        );
        
        console.log(`Changes detected: ${newAlerts.length} new, ${updatedAlerts.length} updated, ${unchangedAlerts.length} unchanged`);
        
        // Generate the HTML page
        await generateHTML(newAlerts, updatedAlerts, unchangedAlerts);
        
        // Store current state for next time
        await updateStoredAlerts(currentAlerts);
        
        console.log('Successfully updated alerts page');
    } catch (error) {
        console.error('Error updating alerts:', error);
        process.exit(1);
    }
}

export { main };
