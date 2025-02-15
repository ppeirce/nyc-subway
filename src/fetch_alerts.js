// src/fetch_alerts.js
import fs from 'fs/promises';
import * as chrono from 'chrono-node';
import OpenAI from "openai";
const openai = new OpenAI();

const generateHTML = (alert) => {

    // alert is of format { header: '...', periods: ['...', ...], normalizedPeriods: [{ start: '...', end: '...' }, ...] }
    // here we convert that into an HTML string
    const alertsHTML = `
        <div class="alert">
            <h2>${alert.header}</h2>
            <h3>Normalized Active Periods</h3>
            <p class="period">This is an attempt at using AI to turn the MTA's inconsistent date ranges into something more useful. It may not be perfect, so please cross-reference with the MTA's original alert text found below.</p>
            <p class="period">
                ${alert.normalizedPeriods.map(period => `${period.start.toLocaleString()} to ${period.end.toLocaleString()}`).join('<br/>')}
            </p>
            <h3>MTA Active Periods</h3>
            <p class="period">This is the original text from the MTA alert. The formatting may be inconsistent, but it's the information straight from the horses mouth, so if there's a discrepency between this and the normalized periods, trust this one.</p>
            <p class="period">${alert.periods.join('<br/>')}</p>
        </div>
    `;
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

/*
* OpenAI API call to normalize active periods
* @param {string} periodStr - The period string to normalize
* @returns {Array} - An array of objects with start and end keys
* 
* The problem we're solving for here is that the MTA does not provide us with nice, clean date ranges.
* Instead, the strings we get are in a variety of formats, such as:
* Feb 25 and Mar 4, Tuesdays, 12:45 AM to 5:00 AM
* Feb 15 - 18, Sat 12:15 AM to Tue 5:00 AM (includes Presidents' Day)
* Sat 12:15 AM to Mon 5:00 AM, Feb 22 - Mar 17
* 
* We want to normalize these into a consistent format of atomic date ranges, this often
* involves breaking up the input string into multiple date ranges.
* 
* We use the OpenAI API to help us with this task, as it requires some natural language processing.
* We provide the input string to the API and it returns the normalized date ranges as strings with the format:
* 2025-02-25 00:45:00 - 2025-02-25 05:00:00
* 
* Then we parse these strings into Date objects and return them as a list of objects with start and end keys.
*/
const openaiNormalizeActivePeriods = async (periodStr) => {
    console.log(`Normalizing active periods with OpenAI: ${periodStr}`);
    const prompt = `Example: Given "Feb 25 and Mar 4, Tuesdays, 12:45 AM to 5:00 AM" This should be broken into two active periods:\n2025-02-25 00:45:00 - 2025-02-25 05:00:00\n2025-03-04 00:45:00 - 2025-03-04 05:00:00\nExample: Given "Feb 15 - 18, Sat 12:15 AM to Tue 5:00 AM (includes Presidents' Day)" This should return a single active period:\n2025-02-15 12:00:00 - 2025-02-18 12:00:00\nFirst, reason through how to format the input correctly. Then when you're ready to answer, write on a new line "Response:", then put the formatted active period(s) on the following lines. One active period per line. The format of your response should exactly match the example given above and should include nothing else, just the appropriate date ranges.\n\nInput: ${periodStr}`;

    const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
            { role: "system", content: "You are a helpful assistant." },
            {
                role: "user",
                content: prompt
            }
        ]
    });

    const messageContent = response.choices[0].message.content;
    console.log(`OpenAI response: ${messageContent}`);

    const flag = 'Response:';
    const repsonseIndex = messageContent.lastIndexOf(flag);
    if (repsonseIndex === -1) {
        console.log('No response found');
        return [{
            start: 'openai query failed',
            end: 'openai query failed'
        }]
    }

    const responseText = messageContent.substring(repsonseIndex + flag.length).trim();
    const lines = responseText.split('\n').map(line => line.trim()).filter(line => line !== '');

    const periods = [];
    for (const line of lines) {
        const parts = line.split(' - ');
        if (parts.length === 2) {
            const start = new Date(parts[0].trim());
            const end = new Date(parts[1].trim());
            periods.push({ start, end });
        }
    }

    return periods;
};

const main = async () => {
    console.log('Main function starting...');
    try {
        const response = await fetch('https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fsubway-alerts.json');
        console.log('API Response status:', response.status);
        
        const data = await response.json();
        console.log('Total alerts received:', data.entity?.length || 0);

        const sevenTrainAlerts = filterAlerts(data.entity || []);

        console.log('Found 7 train alerts:', sevenTrainAlerts.length);

        const processedAlerts = await Promise.all(sevenTrainAlerts.map(async alert => {
            const { headerText, activePeriod } = getAlertDetails(alert);
            let normalizedPeriods = [];

            if (activePeriod) {
                normalizedPeriods = await openaiNormalizeActivePeriods(activePeriod);

            }
            return {
                id: alert.id,
                header: headerText,
                period: activePeriod,
                normalizedPeriods: normalizedPeriods
            };
        }));
        const validAlerts = processedAlerts.filter(alert => alert.header && alert.period);

        console.log('Processed alerts:', validAlerts.length);

        // now we're going to consolidate the alerts
        // the header text is the same for all of them
        // so we're going to combine them all into one alert group
        // with a single header, a list of all active periods, and a list of all normalized active periods
        const consolidatedAlert = validAlerts.reduce((consolidated, alert) => {
            consolidated.header = alert.header;
            consolidated.periods.push(alert.period);
            consolidated.normalizedPeriods.push(...alert.normalizedPeriods);
            return consolidated;
        }, { header: '', periods: [], normalizedPeriods: [] });
        console.log('Consolidated alert:', consolidatedAlert);

        consolidatedAlert.normalizedPeriods.sort((a, b) => new Date(a.start) - new Date(b.start));
        console.log('Sorted consolidated alert:', consolidatedAlert);

        const html = generateHTML(consolidatedAlert);
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
