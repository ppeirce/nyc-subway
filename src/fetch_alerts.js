// src/fetch_alerts.js
console.log('Script starting...');

const main = async () => {
    console.log('Main function starting...');
    try {
        const response = await fetch('https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fsubway-alerts.json');
        console.log('API Response status:', response.status);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('Data received, entities:', data.entity?.length || 0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

// Ensure script runs to completion
main().then(() => {
    console.log('Script completed');
    process.exit(0);
}).catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
