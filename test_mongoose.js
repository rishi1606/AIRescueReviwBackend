const mongoose = require('mongoose');
const Hotel = require('./models/Hotel');
mongoose.connect('mongodb://localhost:27017/reviewrescue').then(async () => {
  const hotel = await Hotel.findOne();
  
  const updated = await Hotel.findByIdAndUpdate(hotel._id, {
    properties: [{
      name: 'Travelodge',
      city: 'Mumbai',
      rooms: 100,
      timezone: 'IST',
      is_active: true,
      platforms: {
        'Booking.com': 'https://www.booking.com/hotel/us/c-conference-center-indianapolis-indiana.html?aid=356980&label=gog235jc-10CAso7AFCKGMtY29uZmVyZW5jZS1jZW50ZXItaW5kaWFuYXBvbGlzLWluZGlhbmFIM1gDaGyIAQGYATO4ARfIAQzYAQPoAQH4AQGIAgGoAgG4Aqq8qtAGwAIB0gIkMjg3YTE3MGEtOWMzZS00NTRhLWJmZjktNzZmN2ZkYTc5MTJj2AIB4AIB&sid=23837c5fa00ca5adfef397fd8aa73790&age=0&dest_id=20037880&dest_type=city&dist=0&group_adults=2&group_children=1&hapos=1&hpos=1&no_rooms=1&req_adults=2&req_age=0&req_children=1&room1=A%2CA%2C0&sb_price_type=total&sr_order=popularity&srepoch=1779080755&srpvid=e35023d5900a0137&type=total&ucfs=1&'
      }
    }]
  }, { new: true });
  
  console.log('Restored Properties:', JSON.stringify(updated.properties, null, 2));
  process.exit(0);
});
