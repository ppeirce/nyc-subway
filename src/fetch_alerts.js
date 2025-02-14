// src/fetch_alerts.js
import fs from 'fs/promises';

const generateHTML = (alerts) => {
    const alertsHTML = alerts.map(alert => `
        <div class="alert">
            <h2>${alert.header}</h2>
            <p class="period">${alert.period}</p>
        </div>
    `).join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>7 Train Service Alerts</title>
    <style>
        body {
            font-family: -apple-system, system-ui, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            background: #f5f5f5;
        }
        .alert {
            background: white;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 20px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .period {
            color: #666;
            font-size: 0.9em;
        }
        .last-updated {
            text-align: center;
            color: #666;
            margin-top: 40px;
        }
    </style>
</head>
<body>
    <h1>7 Train Service Alerts</h1>
    ${alertsHTML}
    <div class="last-updated">
        Last updated: ${new Date().toLocaleString()}
    </div>
</body>
</html>`;
};

const getAlertDetails = (alert) => {
    const alertData = alert.alert || {};
    let headerText = null;
    let activePeriod = null;

    const headerTranslations = alertData.header_text?.translation || [];
    for (const translation of headerTranslations) {
        if (translation.language === 'en') {
            headerText = translation.text;
            break;
        }
    }

    const mercuryAlert = alertData['transit_realtime.mercury_alert'] || {};
    const periodTranslations = mercuryAlert.human_readable_active_period?.translation || [];
    for (const translation of periodTranslations) {
        if (translation.language === 'en') {
            activePeriod = translation.text;
            break;
        }
    }

    return { headerText, activePeriod };
};

const isSuspensionBetweenQBPtoHY = (headerText) => {
    const pattern = 'No [7] between Queensboro Plaza, Queens and 34 St-Hudson Yards, Manhattan';
    return headerText?.includes(pattern);
}

const filterAlerts = (entities) => {
    const foundAlerts = entities.filter(entity => {
        const { headerText } = getAlertDetails(entity);

        const isSuspension = isSuspensionBetweenQBPtoHY(headerText);

        const matchesSortOrder = (entity.alert?.informed_entity || []).some(informedEntity => {
            const mercurySelector = informedEntity['transit_realtime.mercury_entity_selector'] || {};
            return mercurySelector.sort_order === 'MTASBWY:7:20';
        });

        console.log(`\nAnalyzing alert: ${headerText}`);
        console.log('Is suspension:', isSuspension);
        console.log('Matches sort order:', matchesSortOrder);

        return isSuspension;
    });

    console.log('Found alerts:', foundAlerts.length);
    return foundAlerts;

}

const main = async () => {
    console.log('Main function starting...');
    try {
        const response = await fetch('https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fsubway-alerts.json');
        console.log('API Response status:', response.status);
        
        const data = await response.json();
        console.log('Total alerts received:', data.entity?.length || 0);

        const sevenTrainAlerts = filterAlerts(data.entity || []);

        console.log('Found 7 train alerts:', sevenTrainAlerts.length);

        const processedAlerts = sevenTrainAlerts.map(alert => {
            const { headerText, activePeriod } = getAlertDetails(alert);
            return {
                id: alert.id,
                header: headerText,
                period: activePeriod
            };
        }).filter(alert => alert.header && alert.period);

        console.log('Processed alerts:', processedAlerts.length);

        const html = generateHTML(processedAlerts);
        await fs.writeFile('index.html', html);
        console.log('Generated HTML page');

    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
};

main().then(() => {
    console.log('Script completed');
    process.exit(0);
}).catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
