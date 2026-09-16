import { Router, Request, Response } from "express";
import sql from "mssql/msnodesqlv8.js";

const router = Router();

const dbConfig = {
  server: process.env.DB_DWH_SERVER || "DESKTOP-K6HIFFS",
  database: process.env.DB_DWH_NAME || "DWH_Gestion_Cartera",
  driver: "msnodesqlv8",
  options: { trustedConnection: true },
};

router.get(["/avance", "/api/avance"], async (req: Request, res: Response) => {
  const agencia = req.query.agencia as string || "";
  const asesor = req.query.asesor as string || "";

  try {
    const pool = await sql.connect(dbConfig);
    
    // Cruzamos la tabla de avance con las dimensiones usando el periodo actual
    const querySQL = `
      SELECT 
          ISNULL(DA.Agencia, 'Agencia Desconocida') AS Agencia,
          ISNULL(D_AS.Asesor, A.IdSAsesor) AS Asesor,
          ISNULL(A.[Avance Cartera], 0) AS AvanceCartera,
          A.Cuenta,
          A.Pagare,
          A.Socio,
          ISNULL(A.[Celular 1], '') AS Celular1,
          ISNULL(A.[Celular 2], '') AS Celular2,
          ISNULL(A.[Telefono 1], '') AS TelefonoFijo1,
          ISNULL(A.[Telefono 2], '') AS TelefonoFijo2,
          ISNULL(A.[Cuotas Total], 0) AS CuotasTotal,
          ISNULL(A.[Cuotas Canceladas], 0) AS CuotasCanceladas
      FROM [DWH_Gestion_Cartera].[dbo].[avance_cartera] A
      LEFT JOIN [DWH_Gestion_Cartera].[dbo].[dim_asesor] D_AS 
          ON A.IdSAsesor = D_AS.IdSAsesor 
          AND D_AS.Periodo = CONVERT(VARCHAR(6), GETDATE(), 112)
      LEFT JOIN [DWH_Gestion_Cartera].[dbo].[dim_agencia] DA 
          ON D_AS.IdSAgencia = DA.IdSAgencia
      WHERE (@agencia = '' OR RTRIM(LTRIM(DA.Agencia)) = @agencia)
        AND (@asesor = '' OR RTRIM(LTRIM(D_AS.AsesorNombresApellidos)) = @asesor OR RTRIM(LTRIM(D_AS.Asesor)) = @asesor)
      ORDER BY A.[Avance Cartera] DESC;
    `;

    const result = await pool.request()
      .input('agencia', sql.VarChar(50), agencia)
      .input('asesor', sql.VarChar(100), asesor)
      .query(querySQL);

    res.json(result.recordset);
  } catch (error) {
    console.error("Error obteniendo Avance de Cartera:", error);
    res.status(500).json({ error: "Error al consultar la base de datos" });
  }
});

export default router;