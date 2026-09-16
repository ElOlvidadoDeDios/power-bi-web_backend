import { Router, Request, Response } from "express";
import sql from "mssql/msnodesqlv8.js";

const router = Router();

const dbConfig = {
  server: process.env.DB_DWH_SERVER || "DESKTOP-K6HIFFS",
  database: process.env.DB_DWH_NAME || "DWH_Gestion_Cartera",
  driver: "msnodesqlv8",
  options: { trustedConnection: true },
};

router.get(["/cancelados", "/api/cancelados"], async (req: Request, res: Response) => {
  const agencia = req.query.agencia as string || "";
  const asesor = req.query.asesor as string || "";
  const tipoCancelacion = req.query.tipo as string || "";
  const frecuencia = req.query.frecuencia as string || "";

  try {
    const pool = await sql.connect(dbConfig);
    
    // Consulta SQL adaptada exactamente a las columnas de creditos_cancelados_no_renovados
    const querySQL = `
      SELECT 
          ISNULL(DA.Agencia, 'Agencia Desconocida') AS Agencia,
          CONVERT(VARCHAR(10), C.[Fecha_Cancelacion], 103) AS FechaCancelacion,
          ISNULL(D_AS.Asesor, C.IdSAsesor) AS Asesor,
          C.Cuenta,
          C.Socio,
          C.Pagare,
          C.Producto,
          C.[Tipo_Frecuencia] AS TipoFrecuencia,
          ISNULL(C.Prestamo, 0) AS Prestamo,
          ISNULL(C.[Saldo_Cancelacion], 0) AS SaldoCancelacion,
          CONVERT(VARCHAR(10), C.[Fecha_Otorgamiento], 103) AS FechaOtorgamiento,
          C.[Tipo_Cancelacion] AS TipoCancelacion,
          ISNULL(C.[Diferencia_Dias], 0) AS DiferenciaDias,
          ISNULL(C.[Telefono_celular_1], '') AS Celular1,
          ISNULL(C.[Telefono_celular_2], '') AS Celular2,
          ISNULL(C.[Telefono_fijo_1], '') AS TelefonoFijo1,
          ISNULL(C.[Telefono_fijo_2], '') AS TelefonoFijo2
      FROM [DWH_Gestion_Cartera].[dbo].[creditos_cancelados_no_renovados] C
      LEFT JOIN [DWH_Gestion_Cartera].[dbo].[dim_asesor] D_AS 
          ON C.IdSAsesor = D_AS.IdSAsesor 
          -- Cruzamos con el periodo de la fecha de cancelación para obtener el asesor exacto en ese momento
          AND D_AS.Periodo = CONVERT(VARCHAR(6), C.[Fecha_Cancelacion], 112)
      LEFT JOIN [DWH_Gestion_Cartera].[dbo].[dim_agencia] DA 
          ON D_AS.IdSAgencia = DA.IdSAgencia
      WHERE C.[Fecha_Cancelacion] >= DATEADD(month, -6, GETDATE()) -- Últimos 6 meses
        AND (@agencia = '' OR RTRIM(LTRIM(DA.Agencia)) = @agencia)
        AND (@asesor = '' OR RTRIM(LTRIM(D_AS.AsesorNombresApellidos)) = @asesor OR RTRIM(LTRIM(D_AS.Asesor)) = @asesor)
        AND (@tipoCancelacion = '' OR C.[Tipo_Cancelacion] = @tipoCancelacion)
        AND (@frecuencia = '' OR C.[Tipo_Frecuencia] = @frecuencia)
      ORDER BY C.[Fecha_Cancelacion] DESC;
    `;

    const result = await pool.request()
      .input('agencia', sql.VarChar(50), agencia)
      .input('asesor', sql.VarChar(100), asesor)
      .input('tipoCancelacion', sql.VarChar(50), tipoCancelacion)
      .input('frecuencia', sql.VarChar(50), frecuencia)
      .query(querySQL);

    res.json(result.recordset);
  } catch (error) {
    console.error("Error obteniendo Créditos Cancelados:", error);
    res.status(500).json({ error: "Error al consultar la base de datos" });
  }
});

export default router;