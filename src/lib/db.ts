import sql from 'mssql';

const dbConfig = {
    server: process.env.DB_SERVER || "localhost",
    database: "DWH_Gestion_Cartera", // Nos conectamos a esta, pero podemos consultar ambas
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT || "1433"),
    options: {
        encrypt: false, // Local/IP directa
        trustServerCertificate: true
    }
};

export const pool = new sql.ConnectionPool(dbConfig);

export const connectDB = async () => {
    try {
        await pool.connect();
        console.log("✅ Conectado exitosamente a SQL Server");
    } catch (err) {
        console.error("❌ Error al conectar a la base de datos: ", err);
        process.exit(1);
    }
};