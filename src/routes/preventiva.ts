//routes/preventiva.ts

import { Router, Request, Response } from "express";
import sql from "mssql/msnodesqlv8.js";

const router = Router();

const dbConfig = {
  server: process.env.DB_DWH_SERVER || "DESKTOP-K6HIFFS",
  database: process.env.DB_DWH_NAME || "DWH_Gestion_Cartera",
  driver: "msnodesqlv8",
  options: {
    trustedConnection: true,
  },
};

// Forzamos la ruta exacta que busca el frontend
router.get("/api/gestion-preventiva", async (_req: Request, res: Response) => {
  try {
    const pool = await sql.connect(dbConfig);
    
    const result = await pool.request().query(`
      WITH ReporteGestionPreventiva AS (
          SELECT 
              CASE (
                  CASE
                      WHEN T_ANA.ID_AGE = '98' THEN
                          CASE
                              WHEN RTRIM(T_ANA.ID_USER) LIKE '%10' THEN '10' 
                              WHEN RTRIM(T_ANA.ID_USER) LIKE '%11' THEN '11' 
                              WHEN RTRIM(T_ANA.ID_USER) LIKE '%12' THEN '12' 
                              WHEN RTRIM(T_ANA.ID_USER) LIKE '%13' THEN '13' 
                              WHEN RTRIM(T_ANA.ID_USER) LIKE '%6'  THEN '06' 
                              WHEN RTRIM(T_ANA.ID_USER) LIKE '%7'  THEN '07' 
                              ELSE '98'
                          END
                      WHEN T_ANA.ID_AGE = '01' THEN
                          CASE
                              WHEN RTRIM(T_ANA.ID_USER) LIKE '%9' THEN '09'
                              ELSE '01'
                          END
                      ELSE T_ANA.ID_AGE
                  END
              )
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
                  ELSE 'Otra Agencia'
              END AS [agencia],
              ISNULL(S.RAZON_SOCIAL, LTRIM(RTRIM(S.APE_PATERNO)) + ' ' + LTRIM(RTRIM(S.APE_MATERNO)) + ', ' + LTRIM(RTRIM(S.NOMBRE))) AS [socio],
              ISNULL(S.TLF_CEL1, ISNULL(S.TLF_CEL2, 'SIN TELEFONO')) AS [telefono],
              TP.NOM_PROD AS [producto],
              C.SALDO_PRES AS [saldo_numerico],
              FORMAT(C.SALDO_PRES, 'N2', 'es-ES') AS [saldo_formateado],
              T_PER.RAZON AS [analista],
              CONVERT(VARCHAR(10), P.FECHA_VCMTO, 103) AS [fecha_vencimiento],
              DATEDIFF(day, GETDATE(), P.FECHA_VCMTO) AS [dias_para_vencimiento]
          FROM PREEC C
          INNER JOIN SOCIOS S ON C.CUENTA = S.CUENTA
          INNER JOIN PRESTAMO P ON C.PAGARE = P.PAGARE
          LEFT JOIN TIPOPROD TP ON C.TIPO_PROD = TP.TIPO_PROD
          INNER JOIN SEGURIDAD.DBO.ANAREC T_ANA ON T_ANA.ID_ANAREC = C.ID_ANA AND T_ANA.FLAG_ANAREC = 'A'
          INNER JOIN SEGURIDAD.dbo.USUARIOS T_USU ON T_USU.ID_USER = T_ANA.ID_USER
          INNER JOIN SEGURIDAD.dbo.GRUPOUSER T_GRU ON T_GRU.ID_GRUPO = T_USU.ID_GRUPO AND T_GRU.NOM_GRUPO = 'CREDITOS'
          INNER JOIN SEGURIDAD.dbo.PERSONAL T_PER ON T_PER.DNI = T_USU.DNI
          INNER JOIN SEGURIDAD.dbo.TCARGO_USER T_CAR ON T_CAR.ID_CARGO = T_PER.ID_CARGO
          WHERE 
              C.PERIODO = CONVERT(VARCHAR(6), GETDATE(), 112)
              AND C.SALDO_PRES > 0             
              AND P.SALDO_PRES > 0  
              AND P.FECHA_VCMTO >= CAST(GETDATE() AS DATE)
              AND P.FECHA_VCMTO <= DATEADD(day, 5, CAST(GETDATE() AS DATE))
              AND T_CAR.DESCRIP LIKE '%ANALISTA DE CREDITOS%'
              AND T_USU.ID_USER NOT IN ('PRECASTIGO', 'RJULI6', 'RJULIACA', 'RLIMA7', 'RQUILLA3', 'RSICUA4', 'LHR5', 'HTEJ5', 'TKPN5', 'GHVJ5', 'OTA5', 'SDHF5', 'CMN5', 'HQND5', 'RTRES')
      )
      SELECT * FROM ReporteGestionPreventiva
      ORDER BY [dias_para_vencimiento] ASC, [saldo_numerico] DESC;
    `);

    res.json(result.recordset);
  } catch (error) {
    console.error("Error en BD:", error);
    res.status(500).json({ error: "Error obteniendo datos de Gestión Preventiva" });
  }
});

export default router;