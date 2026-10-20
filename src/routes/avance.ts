import { Router, Request, Response } from "express";
import sql from "mssql";
import { pool } from "../lib/db";

const router = Router();

router.get(["/avance", "/api/avance"], async (req: Request, res: Response) => {
  const agenciaParam = req.query.agencia as string || "";
  const asesorParam = req.query.asesor as string || "";
  const vista = req.query.vista as string || "comercial"; // 'comercial' o 'recuperacion'
  
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 100; // Por defecto 100
  const offset = (page - 1) * limit;

  const agencia = (agenciaParam === "Todas" || agenciaParam === "Todas las Agencias") ? "" : agenciaParam;
  const asesor = (asesorParam === "Todos") ? "" : asesorParam;

  try {
    const request = pool.request();
    
    const filtroVistaSQL = vista === 'comercial' 
      ? `AND DA.Agencia IS NOT NULL AND DA.Agencia NOT IN ('Agencia Desconocida', 'NULL')`
      : `AND (DA.Agencia IS NULL OR DA.Agencia IN ('Agencia Desconocida', 'NULL'))`;

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
      FROM [DWH_Gestion_Cartera].[dbo].[avance_cartera] A WITH (NOLOCK)
      LEFT JOIN [DWH_Gestion_Cartera].[dbo].[dim_asesor] D_AS WITH (NOLOCK)
          ON A.IdSAsesor = D_AS.IdSAsesor 
          AND D_AS.Periodo = CONVERT(VARCHAR(6), GETDATE(), 112)
      LEFT JOIN [DWH_Gestion_Cartera].[dbo].[dim_agencia] DA WITH (NOLOCK)
          ON D_AS.IdSAgencia = DA.IdSAgencia
      WHERE (@agencia = '' OR RTRIM(LTRIM(DA.Agencia)) = @agencia)
        AND (@asesor = '' OR RTRIM(LTRIM(D_AS.AsesorNombresApellidos)) = @asesor OR RTRIM(LTRIM(D_AS.Asesor)) = @asesor)
        ${filtroVistaSQL}
      ORDER BY A.[Avance Cartera] DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY;
    `;

    const result = await request
      .input('agencia', sql.VarChar(50), agencia)
      .input('asesor', sql.VarChar(100), asesor)
      .input('offset', sql.Int, offset)
      .input('limit', sql.Int, limit)
      .query(querySQL);

    res.json(result.recordset);
  } catch (error) {
    console.error("Error obteniendo Avance de Cartera:", error);
    res.status(500).json({ error: "Error al consultar la base de datos" });
  }
});

export default router;