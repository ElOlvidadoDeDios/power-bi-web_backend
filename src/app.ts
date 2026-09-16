//app.ts

import express from 'express';
import cors from 'cors';
import routes from './routes'; // Importa el enrutador que tienes en la carpeta routes

const app = express();

// Configuración de middlewares
app.use(cors());
app.use(express.json());

// Ruta base para verificar que el servidor está vivo
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Servidor DWH funcionando correctamente' });
});

// Conectar todas tus rutas modulares bajo el prefijo /api
app.use('/api', routes);

export default app;