// src/routes/pagosMora.ts
import { Router, Request, Response } from 'express';
import { pool } from '../lib/db';

const router = Router();

router.get(['/pagos-mora', '/api/pagos-mora'], async (req: Request, res: Response) => {
  try {
    const request = pool.request();

    // Consulta que trae los registros de pagos de hoy y ayer desde SQL Server
    const querySQL = `
      SELECT 
          RTRIM(LTRIM([Pagare])) AS pagare,
          CASE [Agencia]
              WHEN '01' THEN 'Wanchaq'
              WHEN '02' THEN 'San Jerónimo'
              WHEN '03' THEN 'Quillabamba'
              WHEN '04' THEN 'Sicuani'
              WHEN '05' THEN 'Molino'
              WHEN '06' THEN 'Juliaca'
              WHEN '07' THEN 'Lima Los Olivos'
              WHEN '08' THEN 'Tica Tica'
              WHEN '09' THEN 'Magisterio'
              WHEN '10' THEN 'Lima SJL'
              WHEN '11' THEN 'Chiclayo'
              WHEN '12' THEN 'Arequipa'
              WHEN '13' THEN 'Pucallpa'
              ELSE ISNULL([Agencia], 'Otra Agencia')
          END AS agencia,
          RTRIM(LTRIM([Socio])) AS socio,
          RTRIM(LTRIM([Texto_Mostrar])) AS texto_mostrar,
          CONVERT(VARCHAR(10), [Fecha_Deteccion], 120) AS fecha_deteccion,
          CASE 
              WHEN [Fecha_Deteccion] = CAST(GETDATE() AS DATE) THEN 'HOY'
              ELSE 'AYER'
          END AS tipo
      FROM [DWH_Gestion_Cartera].[dbo].[fct_pagos_mora_diarios] WITH (NOLOCK)
      WHERE [Fecha_Deteccion] >= DATEADD(day, -1, CAST(GETDATE() AS DATE))
      ORDER BY [Fecha_Deteccion] DESC;
    `;

    const result = await request.query(querySQL);
    res.json(result.recordset || []);
  } catch (error) {
    console.error('Error obteniendo pagos de mora diarios:', error);
    // Si la tabla aún no se ha creado en SQL, devolvemos un array vacío para evitar romper el frontend
    res.json([]);
  }
});

export default router;