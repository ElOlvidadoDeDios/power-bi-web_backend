// D:\Proyectos\power-bi-web_backend\src\routes\avance.ts
import { Router, Request, Response } from "express";
import sql from "mssql";
import { pool } from "../lib/db";

const router = Router();

router.get(["/avance", "/api/avance"], async (req: Request, res: Response) => {
  const agenciaParam = (req.query.agencia as string) || "";
  const asesorParam = (req.query.asesor as string) || "";
  const vista = (req.query.vista as string) || "comercial";

  const page = Math.max(parseInt(req.query.page as string) || 1, 1);
  const limit = Math.max(parseInt(req.query.limit as string) || 100, 1);
  const offset = (page - 1) * limit;

  const agencia = agenciaParam === "Todas" || agenciaParam === "Todas las Agencias" ? "" : agenciaParam.trim();
  const asesor = asesorParam === "Todos" ? "" : asesorParam.trim();

  try {
    const request = pool.request();

    const filtroVistaSQL =
      vista === "comercial"
        ? `AND DA.Agencia IS NOT NULL AND DA.Agencia NOT IN ('Agencia Desconocida', 'NULL')`
        : `AND (DA.Agencia IS NULL OR DA.Agencia IN ('Agencia Desconocida', 'NULL'))`;

    const querySQL = `
      SELECT 
          ISNULL(DA.Agencia, 'Agencia Desconocida') AS Agencia,
          ISNULL(D_AS.Asesor, A.IdSAsesor) AS Asesor,
          ISNULL(A.[Avance Cartera], 0) AS AvanceCartera,
          RIGHT('000000000000' + LTRIM(RTRIM(CAST(A.Cuenta AS VARCHAR(20)))), 12) AS Cuenta,
          A.Pagare,
          A.Socio,
          ISNULL(A.[Celular 1], '') AS Celular1,
          ISNULL(A.[Celular 2], '') AS Celular2,
          ISNULL(A.[Telefono 1], '') AS TelefonoFijo1,
          ISNULL(A.[Telefono 2], '') AS TelefonoFijo2,
          ISNULL(A.[Cuotas Total], 0) AS CuotasTotal,
          ISNULL(A.[Cuotas Canceladas], 0) AS CuotasCanceladas,
          COUNT(*) OVER() AS TotalRegistrosGlobal,
          AVG(CAST(ISNULL(A.[Avance Cartera], 0) AS FLOAT)) OVER() AS PromedioAvanceGlobal
      FROM [DWH_Gestion_Cartera].[dbo].[avance_cartera] A WITH (NOLOCK)
      OUTER APPLY (
          SELECT TOP 1 
              D.[IdSAgencia],
              D.[Asesor],
              D.[AsesorNombresApellidos]
          FROM [DWH_Gestion_Cartera].[dbo].[dim_asesor] D WITH (NOLOCK)
          WHERE RTRIM(LTRIM(D.[IdSAsesor])) = RTRIM(LTRIM(A.[IdSAsesor]))
          ORDER BY D.[Periodo] DESC
      ) D_AS
      LEFT JOIN [DWH_Gestion_Cartera].[dbo].[dim_agencia] DA WITH (NOLOCK)
          ON RIGHT('00' + RTRIM(LTRIM(D_AS.IdSAgencia)), 2) = RIGHT('00' + RTRIM(LTRIM(DA.IdSAgencia)), 2)
      WHERE (@agencia = '' OR RTRIM(LTRIM(DA.Agencia)) = @agencia)
        AND (@asesor = '' OR RTRIM(LTRIM(D_AS.AsesorNombresApellidos)) = @asesor OR RTRIM(LTRIM(D_AS.Asesor)) = @asesor)
        ${filtroVistaSQL}
      ORDER BY A.[Avance Cartera] DESC, A.Pagare ASC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY;
    `;

    const result = await request
      .input("agencia", sql.VarChar(50), agencia)
      .input("asesor", sql.VarChar(100), asesor)
      .input("offset", sql.Int, offset)
      .input("limit", sql.Int, limit)
      .query(querySQL);

    res.json(result.recordset || []);
  } catch (error) {
    console.error("Error obteniendo Avance de Cartera:", error);
    res.status(500).json({ error: "Error al consultar la base de datos" });
  }
});

export default router;