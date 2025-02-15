// src/fetch_alerts.js
import fs from 'fs/promises';

const generateHTML = (alerts) => {
    const alertsHTML = alerts.map(alert => `
        <div class="alert">
            <h2>${alert.header}</h2>
            <p class="period">${alert.period}</p>
            <p class="period">${alert.normalizedPeriods}</p>
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

// Helper to parse a time string like "12:45 AM" and return an object with hours and minutes
const parseTime = (timeStr) => {
    const [time, modifier] = timeStr.trim().split(/\s+/);
    let [hours, minutes] = time.split(':').map(Number);
    if (modifier.toUpperCase() === 'PM' && hours !== 12) {
        hours += 12;
    }
    if (modifier.toUpperCase() === 'AM' && hours === 12) {
        hours = 0;
    }
    return { hours, minutes };
};

// Helper to parse month and day (assumes current year, 2025)
const parseMonthDay = (str) => {
    const [monthStr, dayStr] = str.trim().split(' ');
    const monthAbbr = {
        Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5,
        Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11
    };
    const month = monthAbbr[monthStr];
    const day = parseInt(dayStr, 10);
    return new Date(2025, month, day);
};

// Helper to format a Date object as "YYYY-MM-DD HH:mm:ss"
const formatDateTime = (date) => {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())} ` +
           `${pad(date.getHours())}:${pad(date.getMinutes())}:00`;
};

const normalizeActivePeriods = (periodStr) => {
    let periods = [];
    
    // Pattern 1:
    // Example: "Feb 25 and Mar 4, Tuesdays, 12:45 AM to 5:00 AM"
    const pattern1 = /^([\w]+\s\d+(?:\s*and\s*[\w]+\s\d+)+),\s*[\w]+s?,\s*(\d{1,2}:\d{2}\s*[APMapm]{2})\s*to\s*(\d{1,2}:\d{2}\s*[APMapm]{2})$/;
    // Pattern 2:
    // Example: "Sat 12:15 AM to Mon 5:00 AM, Feb 22 - Mar 17"
    const pattern2 = /^([A-Za-z]{3})\s+(\d{1,2}:\d{2}\s*[APMapm]{2})\s+to\s+([A-Za-z]{3})\s+(\d{1,2}:\d{2}\s*[APMapm]{2}),\s*([\w]+\s+\d{1,2}\s*-\s*[\w]+\s+\d{1,2})$/;
    
    const match1 = periodStr.match(pattern1);
    if (match1) {
        // Extract parts
        const datesPart = match1[1]; // e.g. "Feb 25 and Mar 4"
        const startTimeStr = match1[2]; // e.g. "12:45 AM"
        const endTimeStr = match1[3]; // e.g. "5:00 AM"
        
        const startTime = parseTime(startTimeStr);
        const endTime = parseTime(endTimeStr);
        
        // Split on "and"
        const dateStrs = datesPart.split(/\s*and\s*/);
        dateStrs.forEach(dateStr => {
            const date = parseMonthDay(dateStr);
            let start = new Date(date);
            start.setHours(startTime.hours, startTime.minutes, 0, 0);
            let end = new Date(date);
            end.setHours(endTime.hours, endTime.minutes, 0, 0);
            periods.push({
                start: formatDateTime(start),
                end: formatDateTime(end)
            });
        });
        return periods;
    }
    
    const match2 = periodStr.match(pattern2);
    if (match2) {
        // Extract parts
        const startDayStr = match2[1]; // e.g. "Sat"
        const startTimeStr = match2[2]; // e.g. "12:15 AM"
        const endDayStr = match2[3];   // e.g. "Mon"
        const endTimeStr = match2[4];  // e.g. "5:00 AM"
        const rangeStr = match2[5];    // e.g. "Feb 22 - Mar 17"
        
        const startTime = parseTime(startTimeStr);
        const endTime = parseTime(endTimeStr);
        
        // Parse the date range endpoints
        const [startRangeStr, endRangeStr] = rangeStr.split('-').map(s => s.trim());
        const rangeStart = parseMonthDay(startRangeStr);
        const rangeEnd = parseMonthDay(endRangeStr);
        
        // Map day abbreviations to JS weekday numbers (0=Sun,...,6=Sat)
        const dayMap = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };
        const targetStartDay = dayMap[startDayStr];
        const targetEndDay = dayMap[endDayStr];
        
        // Find the first occurrence of the targetStartDay on or after rangeStart
        let current = new Date(rangeStart);
        while (current.getDay() !== targetStartDay) {
            current.setDate(current.getDate() + 1);
        }
        
        // For each occurrence, add a period if within rangeEnd
        while (current <= rangeEnd) {
            let periodStart = new Date(current);
            periodStart.setHours(startTime.hours, startTime.minutes, 0, 0);
            // Compute end day: difference in days (wrap around week if needed)
            let diff = (targetEndDay - targetStartDay + 7) % 7;
            // If diff === 0 then assume the same day: add 0 days; however, in our case diff>0
            let periodEnd = new Date(current);
            periodEnd.setDate(periodEnd.getDate() + diff);
            periodEnd.setHours(endTime.hours, endTime.minutes, 0, 0);
            // Only include if periodEnd is within the provided range (inclusive)
            if (periodEnd <= rangeEnd || periodStart <= rangeEnd) {
                periods.push({
                    start: formatDateTime(periodStart),
                    end: formatDateTime(periodEnd)
                });
            }
            // Move to next week occurrence
            current.setDate(current.getDate() + 7);
        }
        return periods;
    }
    
    // If no pattern matched, return the original string as a single period.
    return [{ start: periodStr, end: periodStr }];
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

        const processedAlerts = sevenTrainAlerts.map(alert => {
            const { headerText, activePeriod } = getAlertDetails(alert);
            let normalizedPeriods = [];
            if (activePeriod) {
                normalizedPeriods = normalizeActivePeriods(activePeriod);
            }
            return {
                id: alert.id,
                header: headerText,
                period: activePeriod,
                normalizedPeriods: normalizedPeriods
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
