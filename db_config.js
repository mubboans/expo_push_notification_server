import mg from 'mongoose';
export async function connectDatabase(dbUrl) {
    console.log('Connecting to MongoDB Atlas...');
    mg.connect(dbUrl, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        serverSelectionTimeoutMS: 20000, 
    }).then(() => {
        console.log('Connected to MongoDB Atlas' + dbUrl);
    }).catch((error) => {
        console.error('Error connecting to MongoDB Atlas:', error);
    });
}