// src/fetch_alerts.js
console.log('Script starting...');

const getAlertDetails = (alert) => {
    const alertData = alert.alert || {};
    let headerText = null;
    let activePeriod = null;

    // Get header text
    const headerTranslations = alertData.header_text?.translation || [];
    for (const translation of headerTranslations) {
        if (translation.language === 'en') {
            headerText = translation.text;
            break;
        }
    }

    // Get active period
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

const main = async () => {
    console.log('Main function starting...');
    try {
        const response = await fetch('https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fsubway-alerts.json');
        console.log('API Response status:', response.status);
        
        const data = await response.json();
        console.log('Total alerts received:', data.entity?.length || 0);

        // Filter for 7 train alerts
        const sevenTrainAlerts = data.entity.filter(entity => {
            const alert = entity.alert || {};
            const informedEntities = alert.informed_entity || [];
            
            return informedEntities.some(informedEntity => {
                const mercurySelector = informedEntity['transit_realtime.mercury_entity_selector'] || {};
                const sortOrder = mercurySelector.sort_order;
                console.log('Found sort order:', sortOrder);
                return sortOrder === 'MTASBWY:7:20';
            });
        });

        console.log('\nFound 7 train alerts:', sevenTrainAlerts.length);

        // Process each 7 train alert
        sevenTrainAlerts.forEach(alert => {
            const { headerText, activePeriod } = getAlertDetails(alert);
            console.log('\nAlert:', {
                id: alert.id,
                header: headerText,
                period: activePeriod
            });
        });

    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
};

main().then(() => {
    console.log('\nScript completed');
    process.exit(0);
}).catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
