// D:\Proyectos\power-bi-web_backend\src\routes\diaria.ts
import { Router, Request, Response } from "express";
import sql from "mssql";
import { pool } from "../lib/db";
import { resolveAgencyCode } from "../lib/agencies";

const router = Router();

router.get(
  [
    "/diaria/:periodo",
    "/diaria",
    "/productividad-diaria",
    "/api/diaria/:periodo",
    "/api/diaria",
    "/api/productividad-diaria",
  ],
  async (req: Request, res: Response) => {
    const rawPeriodo = String(req.params.periodo || req.query.periodo || "");
    const periodo = rawPeriodo.replace(/[^0-9]/g, "").slice(0, 6);

    const agencia = String(req.query.agencia || "Todas").trim();
    const asesor = String(req.query.asesor || "Todos").trim();
    const fecha = String(req.query.day || req.query.fecha || "Hoy").trim();

    const firstAge = agencia.split(",")[0].trim();
    const resolvedAge = resolveAgencyCode(firstAge);
    const idAgencia = /^\d{2}$/.test(resolvedAge) ? resolvedAge : "";

    try {
      const request = pool.request();
      request.input("periodo", sql.VarChar(6), periodo);
      request.input("idAgencia", sql.VarChar(2), idAgencia);
      request.input("asesor", sql.VarChar(150), asesor);
      request.input("fechaParam", sql.VarChar(20), fecha);

      const querySQL = `
        DECLARE @PeriodoEfectivo VARCHAR(6) = @periodo;
        IF @PeriodoEfectivo = ''
            SET @PeriodoEfectivo = CONVERT(VARCHAR(6), DATEADD(hour, -5, GETUTCDATE()), 112);

        DECLARE @FechaObjetivo DATE;

        IF @fechaParam = 'Hoy'
            SET @FechaObjetivo = CAST(DATEADD(hour, -5, GETUTCDATE()) AS DATE);
        ELSE IF @fechaParam = 'Ayer'
            SET @FechaObjetivo = CAST(DATEADD(day, -1, DATEADD(hour, -5, GETUTCDATE())) AS DATE);
        ELSE
            SET @FechaObjetivo = COALESCE(
                TRY_CONVERT(DATE, @fechaParam, 23),
                TRY_CONVERT(DATE, @fechaParam, 103),
                TRY_CAST(@fechaParam AS DATE)
            );

        IF @FechaObjetivo IS NULL
            SET @FechaObjetivo = (
                SELECT MAX(CAST(Fecha AS DATE)) 
                FROM [DWH_Gestion_Cartera].[dbo].[fct_flow] WITH (NOLOCK)
                WHERE Periodo = @PeriodoEfectivo
            );

        WITH Agencias AS (
            SELECT * FROM (VALUES 
                ('01', 'Wanchaq'), ('02', 'San Jerónimo'), ('03', 'Quillabamba'),
                ('04', 'Sicuani'), ('05', 'Molino'), ('06', 'Juliaca'),
                ('07', 'Lima Los Olivos'), ('08', 'Tica Tica'), ('09', 'Magisterio'),
                ('10', 'Lima SJL'), ('11', 'Chiclayo'), ('12', 'Arequipa'),
                ('13', 'Pucallpa')
            ) AS t(IdSAgencia, NombreAgencia)
        ),
        MetasDiarias AS (
            SELECT 
                RIGHT('00' + RTRIM(LTRIM(IdSAgencia)), 2) AS IdSAgencia,
                ISNULL(SUM(Op_Faltantes_Dia), 0) AS metaOp,
                ISNULL(SUM(Proy_Op_Admin), 0) AS proyOp,
                ISNULL(SUM(Crec_Faltante_Dia), 0) AS metaMonto,
                ISNULL(SUM(Proy_Monto_Admin), 0) AS proyMonto
            FROM [DWH_Gestion_Cartera].[dbo].[fct_metas_diarias_control] WITH (NOLOCK)
            WHERE Fecha = @FechaObjetivo
            GROUP BY RIGHT('00' + RTRIM(LTRIM(IdSAgencia)), 2)
        ),
        AsesoresFiltrados AS (
            SELECT DISTINCT RTRIM(LTRIM(IdSAsesor)) AS IdSAsesor
            FROM [DWH_Gestion_Cartera].[dbo].[dim_asesor] WITH (NOLOCK)
            WHERE Periodo = @PeriodoEfectivo 
              AND (Cargo NOT LIKE '%RECUPER%' OR Cargo IS NULL)
              AND (@asesor = 'Todos' OR RTRIM(LTRIM(AsesorNombresApellidos)) = @asesor OR RTRIM(LTRIM(Asesor)) = @asesor)
        ),
        RealDiario AS (
            SELECT 
                RIGHT('00' + RTRIM(LTRIM(F.IdSAgencia)), 2) AS IdSAgencia,
                ISNULL(SUM(F.ColocacionNumReal), 0) AS realOp,
                ISNULL(SUM(F.ColocacionMontoReal), 0) AS realMonto
            FROM [DWH_Gestion_Cartera].[dbo].[fct_flow] F WITH (NOLOCK)
            INNER JOIN AsesoresFiltrados A ON RTRIM(LTRIM(F.IdSAsesor)) = A.IdSAsesor
            WHERE F.Periodo = @PeriodoEfectivo
              AND CAST(F.Fecha AS DATE) = @FechaObjetivo
            GROUP BY RIGHT('00' + RTRIM(LTRIM(F.IdSAgencia)), 2)
        )
        SELECT 
            A.IdSAgencia AS idAgencia,
            A.NombreAgencia AS agency,
            A.NombreAgencia AS agencia,
            CASE WHEN @asesor = 'Todos' THEN ISNULL(M.metaOp, 0) ELSE 0 END AS targetCount,
            CASE WHEN @asesor = 'Todos' THEN ISNULL(M.proyOp, 0) ELSE 0 END AS projectionCount,
            ISNULL(R.realOp, 0) AS achievedCount,
            CASE WHEN @asesor = 'Todos' THEN ISNULL(M.metaMonto, 0) ELSE 0 END AS targetAmount,
            CASE WHEN @asesor = 'Todos' THEN ISNULL(M.proyMonto, 0) ELSE 0 END AS projectionAmount,
            ISNULL(R.realMonto, 0) AS achievedAmount
        FROM Agencias A
        LEFT JOIN MetasDiarias M ON A.IdSAgencia = M.IdSAgencia
        LEFT JOIN RealDiario R ON A.IdSAgencia = R.IdSAgencia
        WHERE (@idAgencia = '' OR A.IdSAgencia = @idAgencia)
        ORDER BY A.IdSAgencia ASC;

        WITH AsesoresDetalle AS (
            SELECT 
                RTRIM(LTRIM(IdSAsesor)) AS IdSAsesor, 
                MAX(ISNULL(AsesorNombresApellidos, Asesor)) AS nombreAsesor,
                MAX(RIGHT('00' + RTRIM(LTRIM(IdSAgencia)), 2)) AS IdSAgencia
            FROM [DWH_Gestion_Cartera].[dbo].[dim_asesor] WITH (NOLOCK)
            WHERE Periodo = @PeriodoEfectivo 
              AND (Cargo NOT LIKE '%RECUPER%' OR Cargo IS NULL)
              AND (@idAgencia = '' OR RIGHT('00' + RTRIM(LTRIM(IdSAgencia)), 2) = @idAgencia)
              AND (@asesor = 'Todos' OR RTRIM(LTRIM(AsesorNombresApellidos)) = @asesor OR RTRIM(LTRIM(Asesor)) = @asesor)
            GROUP BY RTRIM(LTRIM(IdSAsesor))
        )
        SELECT 
            A.nombreAsesor AS asesor,
            CASE A.IdSAgencia
                WHEN '01' THEN 'Wanchaq' WHEN '02' THEN 'San Jerónimo' WHEN '03' THEN 'Quillabamba'
                WHEN '04' THEN 'Sicuani' WHEN '05' THEN 'Molino' WHEN '06' THEN 'Juliaca'
                WHEN '07' THEN 'Lima Los Olivos' WHEN '08' THEN 'Tica Tica' WHEN '09' THEN 'Magisterio'
                WHEN '10' THEN 'Lima SJL' WHEN '11' THEN 'Chiclayo' WHEN '12' THEN 'Arequipa'
                WHEN '13' THEN 'Pucallpa' ELSE 'Otra'
            END AS agency,
            ISNULL(SUM(F.ColocacionNumReal), 0) AS operations,
            ISNULL(SUM(F.ColocacionMontoReal), 0) AS disbursements
        FROM AsesoresDetalle A
        LEFT JOIN [DWH_Gestion_Cartera].[dbo].[fct_flow] F WITH (NOLOCK)
            ON A.IdSAsesor = RTRIM(LTRIM(F.IdSAsesor)) 
            AND F.Periodo = @PeriodoEfectivo 
            AND CAST(F.Fecha AS DATE) = @FechaObjetivo
        GROUP BY A.IdSAsesor, A.nombreAsesor, A.IdSAgencia
        HAVING ISNULL(SUM(F.ColocacionNumReal), 0) > 0 OR @asesor <> 'Todos'
        ORDER BY disbursements DESC, operations DESC;
      `;

      const result = await request.query(querySQL);
      const sets = result.recordsets as any[];

      res.json({
        agencias: sets[0] || [],
        asesores: sets[1] || [],
      });
    } catch (error) {
      console.error("Error obteniendo Productividad Diaria:", error);
      res.status(500).json({ error: "Error calculando productividad diaria" });
    }
  }
);

export default router;