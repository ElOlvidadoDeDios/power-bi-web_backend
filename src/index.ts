import dotenv from 'dotenv';
dotenv.config(); // <-- Forma explícita y segura de cargar el .env

import app from "./app";
import { logger } from "./lib/logger";
import { connectDB } from './lib/db'; // Importamos la función

const rawPort = process.env["PORT"] || "3000";

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Creamos una función asíncrona para iniciar todo en orden
const startServer = async () => {
  // 1. PRIMERO nos conectamos a la Base de Datos
  await connectDB();

  // 2. LUEGO prendemos el servidor web
  app.listen(port, (err?: Error) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
    console.log(`🚀 Backend corriendo correctamente en el puerto ${port}`);
  });
};

// 3. Ejecutamos la función
startServer();