import { Router, Request, Response } from "express";
import sql from "mssql/msnodesqlv8.js";

const router = Router();

const dbConfig = {
  server: process.env.DB_DWH_SERVER || "DESKTOP-K6HIFFS",
  database: process.env.DB_DWH_NAME || "DWH_Gestion_Cartera",
  driver: "msnodesqlv8",
  options: { trustedConnection: true },
};

router.get(["/ranking", "/api/ranking"], async (req: Request, res: Response) => {
  const periodo = req.query.periodo as string || "";
  const agencia = req.query.agencia as string || "";
  const asesor = req.query.asesor as string || "";

  if (!periodo) {
    return res.status(400).json({ error: "El parámetro periodo es obligatorio" });
  }

  try {
    const pool = await sql.connect(dbConfig);
    
    // Cruzamos Flow con Agencia, Asesor y Administrador
    const querySQL = `
      SELECT 
          ISNULL(D_AS.Asesor, F.IdSAsesor) AS Asesor,
          SUM(ISNULL(F.ColocacionNumReal, 0)) AS Operaciones,
          SUM(ISNULL(F.ColocacionMontoReal, 0)) AS Desembolsos,
          ISNULL(DA.Agencia, 'Agencia Desconocida') AS Agencia,
          ISNULL(D_ADM.Nombre, 'Sin Administrador asignado') AS Admin
      FROM [DWH_Gestion_Cartera].[dbo].[fct_flow] F
      LEFT JOIN [DWH_Gestion_Cartera].[dbo].[dim_agencia] DA 
          ON F.IdSAgencia = DA.IdSAgencia
      LEFT JOIN [DWH_Gestion_Cartera].[dbo].[dim_asesor] D_AS 
          ON F.IdSAsesor = D_AS.IdSAsesor 
          AND F.Periodo = D_AS.Periodo
      LEFT JOIN [DWH_Gestion_Cartera].[dbo].[dim_administrador] D_ADM
          ON F.IdSAgencia = D_ADM.IdSAgencia 
          AND F.Periodo = D_ADM.Periodo
      WHERE F.Periodo = @periodo
        AND (@agencia = '' OR RTRIM(LTRIM(DA.Agencia)) = @agencia)
        AND (@asesor = '' OR RTRIM(LTRIM(D_AS.AsesorNombresApellidos)) = @asesor OR RTRIM(LTRIM(D_AS.Asesor)) = @asesor)
      GROUP BY 
          ISNULL(D_AS.Asesor, F.IdSAsesor),
          ISNULL(DA.Agencia, 'Agencia Desconocida'),
          ISNULL(D_ADM.Nombre, 'Sin Administrador asignado')
      ORDER BY Operaciones DESC, Desembolsos DESC;
    `;

    const result = await pool.request()
      .input('periodo', sql.VarChar(6), periodo)
      .input('agencia', sql.VarChar(50), agencia)
      .input('asesor', sql.VarChar(100), asesor)
      .query(querySQL);

    res.json(result.recordset);
  } catch (error) {
    console.error("Error obteniendo Ranking de Asesores:", error);
    res.status(500).json({ error: "Error al consultar la base de datos" });
  }
});

export default router;