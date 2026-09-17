// 1. PRIMERO cargamos las variables de entorno
import dotenv from 'dotenv';
dotenv.config();

// 2. LUEGO importamos SQL y armamos la configuración
import sql from 'mssql';

const dbConfig = {
    server: process.env.DB_SERVER || "localhost",
    database: "DWH_Gestion_Cartera",
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT || "1433"),
    options: {
        encrypt: false, 
        trustServerCertificate: true
    }
};

export const pool = new sql.ConnectionPool(dbConfig);

export const connectDB = async () => {
    try {
        // Imprimimos el usuario en la terminal solo para confirmar que ya lo lee
        console.log(`⏳ Intentando conectar con el usuario: '${process.env.DB_USER}'`);
        
        await pool.connect();
        console.log("✅ Conectado exitosamente a SQL Server");
    } catch (err) {
        console.error("❌ Error al conectar a la base de datos: ", err);
        process.exit(1);
    }
};