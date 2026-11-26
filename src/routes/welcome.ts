// D:\Proyectos\power-bi-web_backend\src\routes\welcome.ts
import { Router, Request, Response } from "express";
import sql from "mssql";
import { pool } from "../lib/db";
import { getCombinedVersionSignature } from "../middlewares/smartCache";
import { AGENCY_NAMES, sqlCaseAgencia, resolveAgencyCode } from "../lib/agencies";

const router = Router();

let tablesEnsured = false;

async function ensureWelcomeTables() {
  if (tablesEnsured) return;
  await pool.request().query(`
    IF COL_LENGTH('[DWH_Gestion_Cartera].[dbo].[fct_riesgo_integral]', 'Dni') IS NULL
      ALTER TABLE [DWH_Gestion_Cartera].[dbo].[fct_riesgo_integral] ADD [Dni] VARCHAR(20) NULL;

    IF OBJECT_ID('[DWH_Gestion_Cartera].[dbo].[fct_metas_diarias_control]', 'U') IS NULL
    BEGIN
      CREATE TABLE [DWH_Gestion_Cartera].[dbo].[fct_metas_diarias_control] (
        [Fecha] DATE NOT NULL,
        [IdSAgencia] VARCHAR(2) NOT NULL,
        [Op_Faltantes_Dia] INT NOT NULL DEFAULT 0,
        [Crec_Faltante_Dia] FLOAT NOT NULL DEFAULT 0,
        [Sugerencia_Op_Gerencia] INT NULL,
        [Sugerencia_Monto_Gerencia] FLOAT NULL,
        [Proy_Op_Admin] INT NULL,
        [Proy_Monto_Admin] FLOAT NULL,
        [Actualizado_Por] VARCHAR(150) NULL,
        [Rol_Editor] VARCHAR(50) NULL,
        [Fecha_Actualizacion] DATETIME NOT NULL DEFAULT GETDATE(),
        PRIMARY KEY ([Fecha], [IdSAgencia])
      );
    END

    IF OBJECT_ID('[DWH_Gestion_Cartera].[dbo].[fct_metas_diarias_asesor]', 'U') IS NULL
    BEGIN
      CREATE TABLE [DWH_Gestion_Cartera].[dbo].[fct_metas_diarias_asesor] (
        [Fecha] DATE NOT NULL,
        [IdSAsesor] VARCHAR(30) NOT NULL,
        [IdSAgencia] VARCHAR(2) NOT NULL,
        [AsesorNombre] VARCHAR(150) NULL,
        [Meta_Op_Dia] INT NOT NULL DEFAULT 0,
        [Meta_Monto_Dia] FLOAT NOT NULL DEFAULT 0,
        [Fecha_Actualizacion] DATETIME NOT NULL DEFAULT GETDATE(),
        PRIMARY KEY ([Fecha], [IdSAsesor])
      );
    END

    IF OBJECT_ID('[DWH_Gestion_Cartera].[dbo].[auditoria_metas_mensuales]', 'U') IS NULL
    BEGIN
      CREATE TABLE [DWH_Gestion_Cartera].[dbo].[auditoria_metas_mensuales] (
        [Id] INT IDENTITY(1,1) PRIMARY KEY,
        [Periodo] VARCHAR(6) NOT NULL,
        [Usuario_Nombre] VARCHAR(150) NOT NULL,
        [Usuario_Email] VARCHAR(150) NULL,
        [Usuario_Rol] VARCHAR(60) NULL,
        [Resumen_Cambio] NVARCHAR(MAX) NULL,
        [Fecha_Hora] DATETIME NOT NULL DEFAULT GETDATE()
      );
    END

    IF OBJECT_ID('[DWH_Gestion_Cartera].[dbo].[fct_compromisos_mora_web]', 'U') IS NULL
    BEGIN
      CREATE TABLE [DWH_Gestion_Cartera].[dbo].[fct_compromisos_mora_web] (
        [Pagare] VARCHAR(40) NOT NULL PRIMARY KEY,
        [Compromiso_Actual] NVARCHAR(500) NULL,
        [Fecha_Promesa_Actual] DATE NULL,
        [Autor_Actual] VARCHAR(150) NULL,
        [Rol_Actual] VARCHAR(60) NULL,
        [Fecha_Actualizacion] DATETIME NOT NULL DEFAULT GETDATE(),
        [Compromiso_Anterior] NVARCHAR(500) NULL,
        [Fecha_Promesa_Anterior] DATE NULL,
        [Autor_Anterior] VARCHAR(150) NULL,
        [Rol_Anterior] VARCHAR(60) NULL,
        [Fecha_Anterior] DATETIME NULL
      );
    END

    IF OBJECT_ID('[DWH_Gestion_Cartera].[dbo].[fct_compromisos_mora_historial]', 'U') IS NULL
    BEGIN
      CREATE TABLE [DWH_Gestion_Cartera].[dbo].[fct_compromisos_mora_historial] (
        [Id] INT IDENTITY(1,1) PRIMARY KEY,
        [Pagare] VARCHAR(40) NOT NULL,
        [Compromiso] NVARCHAR(500) NULL,
        [Fecha_Promesa] DATE NULL,
        [Autor_Nombre] VARCHAR(150) NULL,
        [Autor_Rol] VARCHAR(60) NULL,
        [Fecha_Registro] DATETIME NOT NULL DEFAULT GETDATE()
      );
    END

    IF OBJECT_ID('[DWH_Gestion_Cartera].[dbo].[cfg_sistema_control]', 'U') IS NULL
    BEGIN
      CREATE TABLE [DWH_Gestion_Cartera].[dbo].[cfg_sistema_control] (
        [Id] INT PRIMARY KEY CHECK ([Id] = 1),
        [Config_Json] NVARCHAR(MAX) NOT NULL,
        [Actualizado_Por] VARCHAR(150) NULL,
        [Usuario_Rol] VARCHAR(60) NULL,
        [Fecha_Actualizacion] DATETIME NOT NULL DEFAULT GETDATE()
      );
    END
  `);
  tablesEnsured = true;
}

async function leerFlagAutoCalcFaltantes(): Promise<boolean> {
  try {
    const resCfg = await pool.request().query(`
      SELECT TOP 1 [Config_Json]
      FROM [DWH_Gestion_Cartera].[dbo].[cfg_sistema_control] WITH (NOLOCK)
      WHERE [Id] = 1
    `);
    const raw = resCfg.recordset?.[0]?.Config_Json;
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return Boolean(parsed?.daemon?.autoCalcFaltantesDiarios);
  } catch {
    return false;
  }
}

router.get(["/welcome/init", "/api/welcome/init"], async (req: Request, res: Response) => {
  try {
    await ensureWelcomeTables();

    const periodoReq = (req.query.periodo as string) || "";
    const agenciaCodeReq = (req.query.id_age as string) || "";
    const asesorReq = ((req.query.asesor as string) || "").trim().slice(0, 150);

    const [periodosRes, autoCalcFaltantesDiarios] = await Promise.all([
      pool.request().query(`
        SELECT DISTINCT RTRIM(LTRIM([Periodo])) AS Periodo 
        FROM [dm_productividad].[dbo].[dim_calendario] WITH (NOLOCK)
        WHERE [Periodo] IS NOT NULL AND LTRIM(RTRIM([Periodo])) <> ''
        ORDER BY RTRIM(LTRIM([Periodo])) DESC
      `),
      leerFlagAutoCalcFaltantes(),
    ]);

    const periodosDisponibles = periodosRes.recordset.map((p: any) => p.Periodo);

    const cleanPeriodoReq = String(periodoReq || "").replace(/[^0-9]/g, "").slice(0, 6);
    const periodo =
      cleanPeriodoReq ||
      periodosDisponibles[0] ||
      new Date().toISOString().slice(0, 7).replace("-", "");

    const resolvedAge = resolveAgencyCode(agenciaCodeReq);
    const idAgencia = /^\d{2}$/.test(resolvedAge) ? resolvedAge : "";

    if (
      agenciaCodeReq &&
      agenciaCodeReq.trim().length > 2 &&
      !["todas", "todas las agencias", "null", "undefined"].includes(
        agenciaCodeReq.trim().toLowerCase()
      )
    ) {
      console.warn(
        `⚠️ [/welcome/init] id_age recibido con >2 chars: "${agenciaCodeReq}" -> normalizado a "${idAgencia}"`
      );
    }

    await pool.request().input("periodo", sql.VarChar(6), periodo).query(`
      IF NOT EXISTS (SELECT 1 FROM [DWH_Gestion_Cartera].[dbo].[dim_administrador] WITH (NOLOCK) WHERE [Periodo] = @periodo)
      BEGIN
        DECLARE @UltimoPeriodoAdmin VARCHAR(6) = (
          SELECT MAX([Periodo]) FROM [DWH_Gestion_Cartera].[dbo].[dim_administrador] WITH (NOLOCK)
        );
        IF @UltimoPeriodoAdmin IS NOT NULL
        BEGIN
          INSERT INTO [DWH_Gestion_Cartera].[dbo].[dim_administrador]
            ([Periodo], [IdSAgencia], [Nombre], [Celular], [CorreoPersonal], [CorreoCorporativo])
          SELECT
            @periodo, [IdSAgencia], [Nombre], [Celular], [CorreoPersonal], [CorreoCorporativo]
          FROM [DWH_Gestion_Cartera].[dbo].[dim_administrador] WITH (NOLOCK)
          WHERE [Periodo] = @UltimoPeriodoAdmin;
        END
      END
    `);

    const [
      kpiResult,
      prodVivoRes,
      metasMensualesRes,
      historialMetasRes,
      adminsRes,
      moraAllRes,
      metaAsesorHoyRes,
      logRes,
      proyeccionRepagosRes,
    ] = await Promise.all([
      // 2.1. KPIs Resumidos Comerciales
      pool
        .request()
        .input("periodo", sql.VarChar(6), periodo)
        .input("idAgencia", sql.VarChar(2), idAgencia)
        .input("asesor", sql.VarChar(150), asesorReq)
        .query(`
          DECLARE @FechaBase DATE = TRY_CAST(@periodo + '01' AS DATE);
          DECLARE @periodoAnt VARCHAR(6) = CASE 
            WHEN @FechaBase IS NOT NULL THEN CONVERT(VARCHAR(6), DATEADD(MONTH, -1, @FechaBase), 112)
            ELSE ''
          END;

          WITH AsesoresComerciales AS (
            SELECT
              Periodo,
              RTRIM(LTRIM(IdSAsesor)) AS IdSAsesor,
              MAX(RIGHT('00' + RTRIM(LTRIM(IdSAgencia)), 2)) AS IdSAgencia,
              ISNULL(MAX(ColocacionNumMeta), 30) AS MetaOpAsesor
            FROM [DWH_Gestion_Cartera].[dbo].[dim_asesor] WITH (NOLOCK)
            WHERE Periodo IN (@periodo, @periodoAnt)
              AND (Cargo <> 'RECUPERADOR' OR Cargo IS NULL)
              AND (@idAgencia = '' OR RIGHT('00' + RTRIM(LTRIM(IdSAgencia)), 2) = @idAgencia)
              AND (
                @asesor = ''
                OR RTRIM(LTRIM(IdSAsesor)) = @asesor
                OR RTRIM(LTRIM(AsesorNombresApellidos)) LIKE '%' + @asesor + '%'
                OR RTRIM(LTRIM(Asesor)) LIKE '%' + @asesor + '%'
              )
            GROUP BY Periodo, RTRIM(LTRIM(IdSAsesor))
          ),
          FlujoPorPeriodo AS (
            SELECT
              F.Periodo,
              RTRIM(LTRIM(F.IdSAsesor)) AS IdSAsesor,
              ISNULL(SUM(F.ColocacionNumReal), 0) AS opLogradas,
              ISNULL(SUM(F.ColocacionMontoReal), 0) AS montoLogrado,
              ISNULL(SUM(F.RepagoReal), 0) AS repagos,
              ISNULL(SUM(CASE WHEN CAST(F.Fecha AS DATE) = CAST(DATEADD(hour, -5, GETUTCDATE()) AS DATE) THEN F.ColocacionNumReal ELSE 0 END), 0) AS opHoy,
              ISNULL(SUM(CASE WHEN CAST(F.Fecha AS DATE) = CAST(DATEADD(hour, -5, GETUTCDATE()) AS DATE) THEN F.ColocacionMontoReal ELSE 0 END), 0) AS montoHoy
            FROM [DWH_Gestion_Cartera].[dbo].[fct_flow] F WITH (NOLOCK)
            WHERE F.Periodo IN (@periodo, @periodoAnt)
            GROUP BY F.Periodo, RTRIM(LTRIM(F.IdSAsesor))
          ),
          StockPorPeriodo AS (
            SELECT
              S.Periodo,
              RTRIM(LTRIM(S.IdSAsesor)) AS IdSAsesor,
              ISNULL(SUM(S.Cartera), 0) AS carteraStock,
              ISNULL(SUM(S.Mora9), 0) AS moraCpp,
              ISNULL(SUM(S.Mora31), 0) AS moraDeficiente,
              ISNULL(SUM(S.Mora150), 0) AS mora150,
              ISNULL(SUM(S.NroSociosAnterior), 0) AS sociosInicio,
              ISNULL(SUM(S.NroSocios), 0) AS sociosActuales,
              ISNULL(SUM(S.NroSociosActivos), 0) AS sociosActivos,
              ISNULL(SUM(S.NroSociosCancelados), 0) AS sociosCancelados,
              ISNULL(SUM(S.NroSociosTraspasados), 0) AS sociosTraspasados,
              ISNULL(SUM(S.NroSociosRecuperacion), 0) AS sociosRecuperacion,
              ISNULL(MAX(S.TEA), 0) AS maxTea
            FROM [DWH_Gestion_Cartera].[dbo].[fct_stock] S WITH (NOLOCK)
            WHERE S.Periodo IN (@periodo, @periodoAnt)
            GROUP BY S.Periodo, RTRIM(LTRIM(S.IdSAsesor))
          ),
          CarteraInicPorPeriodo AS (
            SELECT
              M.Periodo,
              RTRIM(LTRIM(M.IdSAsesor)) AS IdSAsesor,
              ISNULL(SUM(M.CarteraInicial), 0) AS carteraInicial
            FROM [dm_productividad].[dbo].[fct_stock_manubl_asesor_month] M WITH (NOLOCK)
            WHERE M.Periodo IN (@periodo, @periodoAnt)
            GROUP BY M.Periodo, RTRIM(LTRIM(M.IdSAsesor))
          ),
          ResumenPorPeriodo AS (
            SELECT
              A.Periodo,
              ISNULL(SUM(F.opLogradas), 0) AS opLogradas,
              ISNULL(SUM(F.montoLogrado), 0) AS montoLogrado,
              ISNULL(SUM(F.repagos), 0) AS repagos,
              ISNULL(SUM(F.opHoy), 0) AS opHoy,
              ISNULL(SUM(F.montoHoy), 0) AS montoHoy,
              ISNULL(SUM(COALESCE(NULLIF(CI.carteraInicial, 0), S.carteraStock, 0)), 0) AS carteraTotal,
              ISNULL(SUM(S.moraCpp), 0) AS moraCpp,
              ISNULL(SUM(S.moraDeficiente), 0) AS moraDeficiente,
              ISNULL(SUM(S.mora150), 0) AS mora150,
              ISNULL(SUM(S.sociosInicio), 0) AS sociosInicio,
              ISNULL(SUM(S.sociosActuales), 0) AS sociosActuales,
              ISNULL(SUM(S.sociosActivos), 0) AS sociosActivos,
              ISNULL(SUM(S.sociosCancelados), 0) AS sociosCancelados,
              ISNULL(SUM(S.sociosTraspasados), 0) AS sociosTraspasados,
              ISNULL(SUM(S.sociosRecuperacion), 0) AS sociosRecuperacion,
              ISNULL(SUM(A.MetaOpAsesor), 30) AS metaOpIndividual,
              CASE 
                WHEN SUM(F.montoLogrado) > 0 THEN SUM(F.montoLogrado * S.maxTea) / SUM(F.montoLogrado)
                ELSE ISNULL(AVG(S.maxTea), 0)
              END AS teaPromedio
            FROM AsesoresComerciales A
            LEFT JOIN FlujoPorPeriodo F ON A.Periodo = F.Periodo AND A.IdSAsesor = F.IdSAsesor
            LEFT JOIN StockPorPeriodo S ON A.Periodo = S.Periodo AND A.IdSAsesor = S.IdSAsesor
            LEFT JOIN CarteraInicPorPeriodo CI ON A.Periodo = CI.Periodo AND A.IdSAsesor = CI.IdSAsesor
            GROUP BY A.Periodo
          ),
          Actual AS (SELECT * FROM ResumenPorPeriodo WHERE Periodo = @periodo),
          Anterior AS (SELECT * FROM ResumenPorPeriodo WHERE Periodo = @periodoAnt),
          MetasAgencia AS (
            SELECT
              ISNULL(SUM(CASE WHEN ColocacionNumMetaAjus > 0 THEN ColocacionNumMetaAjus ELSE ColocacionNumMeta END), 0) AS metaOpMensual,
              ISNULL(SUM(CASE WHEN ColocacionMontoMetaAjus > 0 THEN ColocacionMontoMetaAjus ELSE ColocacionMontoMeta END), 0) AS metaMontoMensual,
              ISNULL(SUM(CASE WHEN CrecimientoMetaAjus > 0 THEN CrecimientoMetaAjus ELSE CrecimientoMeta END), 0) AS metaCrecimiento
            FROM [dm_productividad].[dbo].[FctMensual] WITH (NOLOCK)
            WHERE Periodo = @periodo
              AND (@idAgencia = '' OR RIGHT('00' + CAST(IdSAgencia AS VARCHAR(2)), 2) = @idAgencia)
          )
          SELECT
            @periodoAnt AS periodoAnterior,
            ISNULL(ACT.opLogradas, 0) AS opLogradas,
            ISNULL(ANT.opLogradas, 0) AS opLogradasAnt,
            ISNULL(ACT.montoLogrado, 0) AS montoLogrado,
            ISNULL(ANT.montoLogrado, 0) AS montoLogradoAnt,
            ISNULL(ACT.repagos, 0) AS repagos,
            ISNULL(ANT.repagos, 0) AS repagosAnt,
            ISNULL(ACT.opHoy, 0) AS opHoy,
            ISNULL(ACT.montoHoy, 0) AS montoHoy,
            CASE WHEN @asesor <> '' THEN ISNULL(ACT.metaOpIndividual, 30) ELSE MA.metaOpMensual END AS metaOpMensual,
            CASE WHEN @asesor <> '' THEN (ISNULL(ACT.metaOpIndividual, 30) * 2500) ELSE MA.metaMontoMensual END AS metaMontoMensual,
            MA.metaCrecimiento,
            ISNULL(ACT.carteraTotal, 0) AS carteraTotal,
            ISNULL(ANT.carteraTotal, 0) AS carteraTotalAnt,
            (ISNULL(ACT.montoLogrado, 0) - ISNULL(ACT.repagos, 0)) AS crecimientoBruto,
            (ISNULL(ANT.montoLogrado, 0) - ISNULL(ANT.repagos, 0)) AS crecimientoBrutoAnt,
            ((ISNULL(ACT.montoLogrado, 0) - ISNULL(ACT.repagos, 0)) - ISNULL(ACT.mora150, 0)) AS crecimientoNeto150,
            ((ISNULL(ANT.montoLogrado, 0) - ISNULL(ANT.repagos, 0)) - ISNULL(ANT.mora150, 0)) AS crecimientoNeto150Ant,
            ISNULL(ACT.moraCpp, 0) AS moraCpp,
            ISNULL(ANT.moraCpp, 0) AS moraCppAnt,
            ISNULL(ACT.moraDeficiente, 0) AS moraDeficiente,
            ISNULL(ANT.moraDeficiente, 0) AS moraDeficienteAnt,
            ISNULL(ACT.mora150, 0) AS mora150,
            ISNULL(ANT.mora150, 0) AS mora150Ant,
            ISNULL(ACT.sociosInicio, 0) AS sociosInicio,
            ISNULL(ANT.sociosInicio, 0) AS sociosInicioAnt,
            ISNULL(ACT.sociosActuales, 0) AS sociosActuales,
            ISNULL(ANT.sociosActuales, 0) AS sociosActualesAnt,
            (ISNULL(ACT.sociosActuales, 0) - ISNULL(ACT.sociosInicio, 0)) AS sociosNuevosNeto,
            (ISNULL(ANT.sociosActuales, 0) - ISNULL(ANT.sociosInicio, 0)) AS sociosNuevosNetoAnt,
            ISNULL(ACT.sociosActivos, 0) AS sociosActivos,
            ISNULL(ANT.sociosActivos, 0) AS sociosActivosAnt,
            ISNULL(ACT.sociosCancelados, 0) AS sociosCancelados,
            ISNULL(ANT.sociosCancelados, 0) AS sociosCanceladosAnt,
            ISNULL(ACT.sociosTraspasados, 0) AS sociosTraspasados,
            ISNULL(ANT.sociosTraspasados, 0) AS sociosTraspasadosAnt,
            ISNULL(ACT.sociosRecuperacion, 0) AS sociosRecuperacion,
            ISNULL(ANT.sociosRecuperacion, 0) AS sociosRecuperacionAnt,
            (ISNULL(ACT.sociosInicio, 0) - ISNULL(ACT.sociosRecuperacion, 0)) AS sociosInicioMenosRecupe,
            (ISNULL(ANT.sociosInicio, 0) - ISNULL(ANT.sociosRecuperacion, 0)) AS sociosInicioMenosRecupeAnt,
            ISNULL(ACT.teaPromedio, 0) AS teaPromedio,
            ISNULL(ANT.teaPromedio, 0) AS teaPromedioAnt
          FROM MetasAgencia MA
          LEFT JOIN Actual ACT ON 1 = 1
          LEFT JOIN Anterior ANT ON 1 = 1;
        `),

      // 2.2. Metas Diarias Unificadas en [DWH_Gestion_Cartera].[dbo].[fct_metas_diarias_control]
      pool
        .request()
        .input("periodo", sql.VarChar(6), periodo)
        .input("autoCalc", sql.Bit, autoCalcFaltantesDiarios ? 1 : 0)
        .query(`
          DECLARE @FechaHoraPeru DATETIME = DATEADD(hour, -5, GETUTCDATE());
          DECLARE @Hoy DATE = CAST(@FechaHoraPeru AS DATE);
          DECLARE @HoraActual TIME = CAST(@FechaHoraPeru AS TIME);

          DECLARE @FechaCorteCalculo DATE = CASE
            WHEN @HoraActual >= '08:00:00' THEN @Hoy
            ELSE DATEADD(day, -1, @Hoy)
          END;

          DECLARE @DiasRestantes INT = (
            SELECT COUNT(Fecha)
            FROM [dm_productividad].[dbo].[dim_calendario] WITH (NOLOCK)
            WHERE Periodo = @periodo
              AND Fecha >= @FechaCorteCalculo
              AND EsDomingo = 0
              AND EsFeriado = 0
          );
          IF ISNULL(@DiasRestantes, 0) < 1 SET @DiasRestantes = 1;

          WITH Agencias AS (
            SELECT * FROM (VALUES
              ('01', 'Wanchaq'), ('02', 'San Jerónimo'), ('03', 'Quillabamba'),
              ('04', 'Sicuani'), ('05', 'Molino'), ('06', 'Juliaca'),
              ('07', 'Lima Los Olivos'), ('08', 'Tica Tica'), ('09', 'Magisterio'),
              ('10', 'Lima SJL'), ('11', 'Chiclayo'), ('12', 'Arequipa'),
              ('13', 'Pucallpa')
            ) AS t(IdSAgencia, NombreAgencia)
          ),
          MetasMensualesAgencia AS (
            SELECT
              RIGHT('00' + RTRIM(LTRIM(CAST(IdSAgencia AS VARCHAR(5)))), 2) AS IdSAgencia,
              ISNULL(SUM(CASE WHEN ISNULL(ColocacionNumMetaAjus, 0) > 0 THEN ColocacionNumMetaAjus ELSE ISNULL(ColocacionNumMeta, 0) END), 0) AS metaOpMes,
              ISNULL(SUM(CASE WHEN ISNULL(CrecimientoMetaAjus, 0) > 0 THEN CrecimientoMetaAjus ELSE ISNULL(CrecimientoMeta, 0) END), 0) AS metaCrecMes,
              ISNULL(SUM(CASE WHEN ISNULL(ColocacionMontoMetaAjus, 0) > 0 THEN ColocacionMontoMetaAjus ELSE ISNULL(ColocacionMontoMeta, 0) END), 0) AS metaMontoMes
            FROM [dm_productividad].[dbo].[FctMensual] WITH (NOLOCK)
            WHERE Periodo = @periodo
            GROUP BY RIGHT('00' + RTRIM(LTRIM(CAST(IdSAgencia AS VARCHAR(5)))), 2)
          ),
          AsesoresCom AS (
            SELECT DISTINCT RTRIM(LTRIM(IdSAsesor)) AS IdSAsesor
            FROM [DWH_Gestion_Cartera].[dbo].[dim_asesor] WITH (NOLOCK)
            WHERE Periodo = @periodo AND (Cargo <> 'RECUPERADOR' OR Cargo IS NULL)
          ),
          LogradoPeriodoInicioDia AS (
            SELECT
              RIGHT('00' + RTRIM(LTRIM(F.IdSAgencia)), 2) AS IdSAgencia,
              ISNULL(SUM(F.ColocacionNumReal), 0) AS opLogradasMes,
              ISNULL(SUM(F.ColocacionMontoReal), 0) AS montoLogradoMes,
              ISNULL(SUM(F.ColocacionMontoReal - ISNULL(F.RepagoReal, 0)), 0) AS crecBrutoMes
            FROM [DWH_Gestion_Cartera].[dbo].[fct_flow] F WITH (NOLOCK)
            INNER JOIN AsesoresCom AC ON RTRIM(LTRIM(F.IdSAsesor)) = AC.IdSAsesor
            WHERE F.Periodo = @periodo
              AND CAST(F.Fecha AS DATE) < @FechaCorteCalculo
            GROUP BY RIGHT('00' + RTRIM(LTRIM(F.IdSAgencia)), 2)
          ),
          Calculo8AM AS (
            SELECT
              A.IdSAgencia,
              CAST(ROUND(CASE WHEN (ISNULL(MM.metaOpMes, 0) - ISNULL(LP.opLogradasMes, 0)) > 0 THEN CAST(ISNULL(MM.metaOpMes, 0) - ISNULL(LP.opLogradasMes, 0) AS FLOAT) / CAST(@DiasRestantes AS FLOAT) ELSE 0 END, 0) AS INT) AS opFaltantesCalc,
              CAST(ROUND(CASE WHEN (ISNULL(NULLIF(MM.metaCrecMes, 0), ISNULL(MM.metaMontoMes, 0)) - ISNULL(LP.crecBrutoMes, 0)) > 0 THEN CAST(ISNULL(NULLIF(MM.metaCrecMes, 0), ISNULL(MM.metaMontoMes, 0)) - ISNULL(LP.crecBrutoMes, 0) AS FLOAT) / CAST(@DiasRestantes AS FLOAT) ELSE 0 END, 0) AS INT) AS crecFaltanteCalc
            FROM Agencias A
            LEFT JOIN MetasMensualesAgencia MM ON A.IdSAgencia = MM.IdSAgencia
            LEFT JOIN LogradoPeriodoInicioDia LP ON A.IdSAgencia = LP.IdSAgencia
          ),
          ControlHoy AS (
            SELECT
              RIGHT('00' + RTRIM(LTRIM(IdSAgencia)), 2) AS IdSAgencia,
              CAST(ROUND(ISNULL(Op_Faltantes_Dia, 0), 0) AS INT) AS Op_Faltantes_Dia,
              CAST(ROUND(ISNULL(Crec_Faltante_Dia, 0), 0) AS INT) AS Crec_Faltante_Dia,
              CAST(ROUND(ISNULL(Proy_Op_Admin, 0), 0) AS INT) AS Proy_Op_Admin,
              CAST(ROUND(ISNULL(Proy_Monto_Admin, 0), 0) AS INT) AS Proy_Monto_Admin,
              Actualizado_Por,
              Rol_Editor,
              CONVERT(VARCHAR(19), Fecha_Actualizacion, 120) AS Fecha_Actualizacion
            FROM [DWH_Gestion_Cartera].[dbo].[fct_metas_diarias_control] WITH (NOLOCK)
            WHERE Fecha = @Hoy
          ),
          ArrastreAnterior AS (
            SELECT
              IdSAgencia,
              Op_Faltantes_Dia,
              Crec_Faltante_Dia
            FROM (
              SELECT
                RIGHT('00' + RTRIM(LTRIM(IdSAgencia)), 2) AS IdSAgencia,
                CAST(ROUND(ISNULL(Op_Faltantes_Dia, 0), 0) AS INT) AS Op_Faltantes_Dia,
                CAST(ROUND(ISNULL(Crec_Faltante_Dia, 0), 0) AS INT) AS Crec_Faltante_Dia,
                ROW_NUMBER() OVER (
                  PARTITION BY RIGHT('00' + RTRIM(LTRIM(IdSAgencia)), 2)
                  ORDER BY Fecha DESC
                ) AS rn
              FROM [DWH_Gestion_Cartera].[dbo].[fct_metas_diarias_control] WITH (NOLOCK)
              WHERE Fecha < @Hoy
                AND (ISNULL(Op_Faltantes_Dia, 0) > 0 OR ISNULL(Crec_Faltante_Dia, 0) > 0)
            ) T
            WHERE rn = 1
          ),
          BaseFaltantes AS (
            SELECT
              A.IdSAgencia,
              A.NombreAgencia,
              CASE
                WHEN @autoCalc = 1 THEN COALESCE(NULLIF(C.Op_Faltantes_Dia, 0), C8.opFaltantesCalc, PREV.Op_Faltantes_Dia, 0)
                ELSE COALESCE(NULLIF(C.Op_Faltantes_Dia, 0), PREV.Op_Faltantes_Dia, C8.opFaltantesCalc, 0)
              END AS opFaltantesFinal,
              CASE
                WHEN @autoCalc = 1 THEN COALESCE(NULLIF(C.Crec_Faltante_Dia, 0), C8.crecFaltanteCalc, PREV.Crec_Faltante_Dia, 0)
                ELSE COALESCE(NULLIF(C.Crec_Faltante_Dia, 0), PREV.Crec_Faltante_Dia, C8.crecFaltanteCalc, 0)
              END AS crecFaltanteFinal,
              ISNULL(C.Proy_Op_Admin, 0) AS proyOpConfirmada,
              ISNULL(C.Proy_Monto_Admin, 0) AS proyMontoConfirmada,
              C.Actualizado_Por,
              C.Rol_Editor,
              C.Fecha_Actualizacion
            FROM Agencias A
            LEFT JOIN ControlHoy C ON A.IdSAgencia = C.IdSAgencia
            LEFT JOIN ArrastreAnterior PREV ON A.IdSAgencia = PREV.IdSAgencia
            LEFT JOIN Calculo8AM C8 ON A.IdSAgencia = C8.IdSAgencia
          ),
          SumaAsesoresHoy AS (
            SELECT
              RIGHT('00' + RTRIM(LTRIM(IdSAgencia)), 2) AS IdSAgencia,
              CAST(ROUND(SUM(Meta_Op_Dia), 0) AS INT) AS sumaOpAsesores,
              CAST(ROUND(SUM(Meta_Monto_Dia), 0) AS INT) AS sumaMontoAsesores
            FROM [DWH_Gestion_Cartera].[dbo].[fct_metas_diarias_asesor] WITH (NOLOCK)
            WHERE Fecha = @Hoy
            GROUP BY RIGHT('00' + RTRIM(LTRIM(IdSAgencia)), 2)
          ),
          LogradoHoy AS (
            SELECT
              RIGHT('00' + RTRIM(LTRIM(IdSAgencia)), 2) AS IdSAgencia,
              CAST(ROUND(ISNULL(SUM(ColocacionNumReal), 0), 0) AS INT) AS colocacionNumReal,
              CAST(ROUND(ISNULL(SUM(ColocacionMontoReal), 0), 0) AS INT) AS colocacionMontoReal
            FROM [DWH_Gestion_Cartera].[dbo].[fct_flow] WITH (NOLOCK)
            WHERE Periodo = @periodo AND CAST(Fecha AS DATE) = @Hoy
            GROUP BY RIGHT('00' + RTRIM(LTRIM(IdSAgencia)), 2)
          )
          SELECT
            CONVERT(VARCHAR(10), @Hoy, 120) AS fecha,
            @periodo AS periodo,
            B.IdSAgencia AS idAgencia,
            B.NombreAgencia AS agencia,
            B.opFaltantesFinal AS opFaltantesDia,
            B.crecFaltanteFinal AS crecFaltanteDia,
            (B.opFaltantesFinal + 1) AS sugerenciaOpGerencia,
            (B.crecFaltanteFinal + 500) AS sugerenciaMontoGerencia,
            B.proyOpConfirmada AS proyeccionColocacion,
            B.proyMontoConfirmada AS proyeccionMonto,
            ISNULL(SA.sumaOpAsesores, 0) AS sumaOpAsesores,
            ISNULL(SA.sumaMontoAsesores, 0) AS sumaMontoAsesores,
            ISNULL(L.colocacionNumReal, 0) AS colocacionNumReal,
            ISNULL(L.colocacionMontoReal, 0) AS colocacionMontoReal,
            CASE
              WHEN B.proyOpConfirmada > 0 OR B.proyMontoConfirmada > 0 THEN ISNULL(B.Actualizado_Por, 'Confirmado')
              ELSE 'Pendiente de proyectar'
            END AS actualizadoPor,
            ISNULL(B.Rol_Editor, '') AS rolEditor,
            ISNULL(B.Fecha_Actualizacion, '') AS fechaActualizacion
          FROM BaseFaltantes B
          LEFT JOIN SumaAsesoresHoy SA ON B.IdSAgencia = SA.IdSAgencia
          LEFT JOIN LogradoHoy L ON B.IdSAgencia = L.IdSAgencia
          ORDER BY B.IdSAgencia ASC;
        `),

      // 2.3. Metas Mensuales
      pool.request().input("periodo", sql.VarChar(6), periodo).query(`
        WITH Agencias AS (
          SELECT * FROM (VALUES
            ('01', 'Wanchaq'), ('02', 'San Jerónimo'), ('03', 'Quillabamba'),
            ('04', 'Sicuani'), ('05', 'Molino'), ('06', 'Juliaca'),
            ('07', 'Lima Los Olivos'), ('08', 'Tica Tica'), ('09', 'Magisterio'),
            ('10', 'Lima SJL'), ('11', 'Chiclayo'), ('12', 'Arequipa'),
            ('13', 'Pucallpa')
          ) AS t(IdSAgencia, NombreAgencia)
        )
        SELECT
          @periodo AS periodo,
          A.IdSAgencia AS idAgencia,
          A.NombreAgencia AS agencia,
          ISNULL(M.ColocacionNumMeta, 0) AS colocacionNumMeta,
          ISNULL(M.ColocacionNumMetaAjus, 0) AS colocacionNumMetaAjus,
          ISNULL(M.ColocacionMontoMeta, 0) AS colocacionMontoMeta,
          ISNULL(M.ColocacionMontoMetaAjus, 0) AS colocacionMontoMetaAjus,
          ISNULL(M.NumeroAsesores, 0) AS numeroAsesores,
          ISNULL(M.NumeroAsesoresAjus, 0) AS numeroAsesoresAjus,
          ISNULL(M.CrecimientoMeta, ISNULL(M.CrecimientoMetaAjus, 0)) AS crecimientoMeta,
          ISNULL(M.CrecimientoMetaAjus, 0) AS crecimientoMetaAjus
        FROM Agencias A
        LEFT JOIN [dm_productividad].[dbo].[FctMensual] M WITH (NOLOCK)
          ON RIGHT('00' + CAST(M.IdSAgencia AS VARCHAR(2)), 2) = A.IdSAgencia
          AND M.Periodo = @periodo
        ORDER BY A.IdSAgencia ASC;
      `),

      // 2.4. Historial de Auditoría de Metas Mensuales
      pool.request().query(`
        SELECT TOP 25
          [Id] AS id,
          [Periodo] AS periodo,
          [Usuario_Nombre] AS usuarioNombre,
          [Usuario_Email] AS usuarioEmail,
          [Usuario_Rol] AS usuarioRol,
          [Resumen_Cambio] AS resumenCambio,
          FORMAT([Fecha_Hora], 'dd/MM/yyyy HH:mm:ss') AS fechaHora
        FROM [DWH_Gestion_Cartera].[dbo].[auditoria_metas_mensuales] WITH (NOLOCK)
        ORDER BY [Fecha_Hora] DESC;
      `),

      // 2.5. Tabla de Administradores
      pool.request().input("periodo", sql.VarChar(6), periodo).query(`
        WITH Agencias AS (
          SELECT * FROM (VALUES
            ('01', 'Wanchaq'), ('02', 'San Jerónimo'), ('03', 'Quillabamba'),
            ('04', 'Sicuani'), ('05', 'Molino'), ('06', 'Juliaca'),
            ('07', 'Lima Los Olivos'), ('08', 'Tica Tica'), ('09', 'Magisterio'),
            ('10', 'Lima SJL'), ('11', 'Chiclayo'), ('12', 'Arequipa'),
            ('13', 'Pucallpa')
          ) AS t(IdSAgencia, NombreAgencia)
        )
        SELECT
          @periodo AS periodo,
          A.IdSAgencia AS idAgencia,
          A.NombreAgencia AS agencia,
          ISNULL(AD.Nombre, '') AS nombre,
          ISNULL(AD.Celular, '') AS celular,
          ISNULL(AD.CorreoPersonal, '') AS correoPersonal,
          ISNULL(AD.CorreoCorporativo, '') AS correoCorporativo
        FROM Agencias A
        LEFT JOIN [DWH_Gestion_Cartera].[dbo].[dim_administrador] AD WITH (NOLOCK)
          ON RIGHT('00' + RTRIM(LTRIM(AD.IdSAgencia)), 2) = A.IdSAgencia
          AND AD.Periodo = @periodo
        ORDER BY A.IdSAgencia ASC;
      `),

      // 2.6. Mora desde el 1er Día + Alertas IA
      pool
        .request()
        .input("idAgencia", sql.VarChar(2), idAgencia)
        .input("asesor", sql.VarChar(150), asesorReq)
        .query(`
          DECLARE @UltimaFecha DATE = (
            SELECT MAX([Fecha_Foto]) FROM [DWH_Gestion_Cartera].[dbo].[fct_riesgo_integral] WITH (NOLOCK)
          );
          DECLARE @HoyPeru DATE = CAST(DATEADD(hour, -5, GETUTCDATE()) AS DATE);

          WITH UltimoAsesor AS (
            SELECT
              RTRIM(LTRIM([IdSAsesor])) AS IdSAsesor,
              ISNULL([AsesorNombresApellidos], [Asesor]) AS NombreAsesor,
              ROW_NUMBER() OVER (
                PARTITION BY RTRIM(LTRIM([IdSAsesor]))
                ORDER BY [Periodo] DESC
              ) AS rn
            FROM [DWH_Gestion_Cartera].[dbo].[dim_asesor] WITH (NOLOCK)
          )
          SELECT
            R.[IdSAgencia] AS idAgencia,
            ${sqlCaseAgencia("R.[IdSAgencia]")} AS agencia,
            RTRIM(LTRIM(R.[IdSAsesor])) AS idAsesor,
            ISNULL(D_AS.NombreAsesor, RTRIM(LTRIM(R.[IdSAsesor]))) AS asesor,
            RTRIM(LTRIM(R.[Pagare])) AS pagare,
            CASE
              WHEN R.[Cuenta] IS NULL OR LTRIM(RTRIM(R.[Cuenta])) = '' THEN ''
              ELSE RIGHT('000000000000' + LTRIM(RTRIM(R.[Cuenta])), 12)
            END AS cuenta,
            LTRIM(RTRIM(ISNULL(R.[Dni], ''))) AS dni,
            RTRIM(LTRIM(R.[Socio])) AS socio,
            RTRIM(LTRIM(ISNULL(R.[Producto], ''))) AS producto,
            R.[Estado_Mora] AS estadoMora,
            ISNULL(R.[Saldo_Capital], 0) AS saldoCapital,
            ISNULL(R.[Cuota_Mensual], 0) AS cuotaMensual,
            ISNULL(R.[Cuotas_Atrasadas], 0) AS cuotasAtrasadas,
            ISNULL(R.[Dias_Atraso], 0) AS diasAtraso,
            ISNULL(R.[Cuotas_Pendientes], 0) AS cuotasPendientes,
            ISNULL(R.[Cuotas_Pagadas], 0) AS cuotasPagadas,
            ISNULL(R.[Avance_Cuota], '0%') AS avanceCuota,
            CASE
              WHEN R.[Fecha_Vcmto_Cuota] IS NOT NULL THEN CONVERT(VARCHAR(10), R.[Fecha_Vcmto_Cuota], 103)
              ELSE ''
            END AS fechaVencimientoCuota,
            CASE
              WHEN R.[Fecha_Vcmto_Cuota] IS NOT NULL THEN DATEDIFF(DAY, @HoyPeru, R.[Fecha_Vcmto_Cuota])
              ELSE R.[Dias_Vcmto_Cuota]
            END AS venceEnDias,
            ISNULL(R.[Telefonos], '') AS telefonos,
            R.[Probabilidad_IA] AS probabilidadIa,
            CASE
              WHEN R.[Probabilidad_IA] >= 65 THEN 'ALTO'
              WHEN R.[Probabilidad_IA] >= 30 THEN 'MEDIO'
              WHEN R.[Probabilidad_IA] IS NOT NULL THEN 'BAJO'
              ELSE R.[Nivel_Riesgo_IA]
            END AS nivelRiesgoIa,
            CASE
              WHEN R.[Probabilidad_IA] >= 30 THEN 1
              ELSE 0
            END AS advertidoPorIa,
            COALESCE(CW.[Compromiso_Actual], R.[Compromiso], '') AS compromiso,
            CASE
              WHEN CW.[Fecha_Promesa_Actual] IS NOT NULL THEN CONVERT(VARCHAR(10), CW.[Fecha_Promesa_Actual], 120)
              WHEN R.[Fecha_Promesa] IS NOT NULL THEN CONVERT(VARCHAR(10), R.[Fecha_Promesa], 120)
              ELSE ''
            END AS fechaPromesa,
            ISNULL(CW.[Autor_Actual], CASE WHEN R.[Compromiso] IS NOT NULL AND R.[Compromiso] <> '' THEN 'Sincronizado GSheets' ELSE '' END) AS autorActual,
            ISNULL(CW.[Rol_Actual], '') AS rolActual,
            CASE WHEN CW.[Fecha_Actualizacion] IS NOT NULL THEN FORMAT(CW.[Fecha_Actualizacion], 'dd/MM/yyyy HH:mm') ELSE '' END AS fechaActualizacionCompromiso,
            ISNULL(CW.[Compromiso_Anterior], '') AS compromisoAnterior,
            CASE WHEN CW.[Fecha_Promesa_Anterior] IS NOT NULL THEN CONVERT(VARCHAR(10), CW.[Fecha_Promesa_Anterior], 103) ELSE '' END AS fechaPromesaAnterior,
            ISNULL(CW.[Autor_Anterior], '') AS autorAnterior,
            ISNULL(CW.[Rol_Anterior], '') AS rolAnterior,
            CASE WHEN CW.[Fecha_Anterior] IS NOT NULL THEN FORMAT(CW.[Fecha_Anterior], 'dd/MM/yyyy HH:mm') ELSE '' END AS fechaAnteriorCompromiso
          FROM [DWH_Gestion_Cartera].[dbo].[fct_riesgo_integral] R WITH (NOLOCK)
          LEFT JOIN [DWH_Gestion_Cartera].[dbo].[fct_compromisos_mora_web] CW WITH (NOLOCK)
            ON RTRIM(LTRIM(R.[Pagare])) = RTRIM(LTRIM(CW.[Pagare]))
          LEFT JOIN UltimoAsesor D_AS
            ON D_AS.IdSAsesor = RTRIM(LTRIM(R.[IdSAsesor])) AND D_AS.rn = 1
          WHERE R.[Fecha_Foto] = @UltimaFecha
            AND (
              R.[Estado_Mora] IN ('3. Mora Potencial', '2. Mora Temprana')
              OR ISNULL(R.[Dias_Atraso], 0) >= 1
              OR R.[Probabilidad_IA] >= 30
            )
            AND (@idAgencia = '' OR RTRIM(LTRIM(R.[IdSAgencia])) = @idAgencia)
            AND (
              @asesor = ''
              OR RTRIM(LTRIM(R.[IdSAsesor])) = @asesor
              OR RTRIM(LTRIM(D_AS.NombreAsesor)) LIKE '%' + @asesor + '%'
            )
          ORDER BY
            CASE WHEN ISNULL(R.[Dias_Atraso], 0) >= 1 THEN 0 ELSE 1 END ASC,
            R.[Dias_Atraso] DESC,
            R.[Probabilidad_IA] DESC,
            R.[Saldo_Capital] DESC;
        `),

      // 2.7. Meta Diaria Propia del Analista
      pool
        .request()
        .input("asesor", sql.VarChar(150), asesorReq)
        .query(`
          SELECT TOP 1
            [Meta_Op_Dia] AS metaOpDia,
            [Meta_Monto_Dia] AS metaMontoDia,
            FORMAT([Fecha_Actualizacion], 'dd/MM/yyyy HH:mm') AS fechaActualizacion
          FROM [DWH_Gestion_Cartera].[dbo].[fct_metas_diarias_asesor] WITH (NOLOCK)
          WHERE [Fecha] = CAST(DATEADD(hour, -5, GETUTCDATE()) AS DATE)
            AND ([IdSAsesor] = @asesor OR [AsesorNombre] LIKE '%' + @asesor + '%')
        `),

      // 2.8. Hora oficial de última actualización
      pool.request().query(`
        SELECT TOP (1)
          FORMAT([UltimaActualizacion], 'dd/MM/yyyy · hh:mm:ss tt', 'es-PE') AS UltimaActualizacion
        FROM [DWH_Gestion_Cartera].[dbo].[Log_Actualizacion] WITH (NOLOCK)
        ORDER BY [UltimaActualizacion] DESC
      `),

      // 2.9. Proyección Híbrida de Repagos, Cancelaciones y Crecimiento Faltante Día
      pool
        .request()
        .query(`
          SELECT *
          FROM [DWH_Gestion_Cartera].[dbo].[fct_proyeccion_repagos_agencia] WITH (NOLOCK)
          WHERE [Fecha] = CAST(DATEADD(hour, -5, GETUTCDATE()) AS DATE)
          ORDER BY [IdSAgencia] ASC;
        `)
        .catch(() => ({ recordset: [] })),
    ]);

    const allMoraRows = moraAllRes.recordset || [];
    const moraPotencialRows = allMoraRows.filter((r: any) => r.estadoMora === "3. Mora Potencial");
    const moraPrimerDiaRows = allMoraRows.filter(
      (r: any) => Number(r.diasAtraso || 0) >= 1 || Number(r.probabilidadIa || 0) >= 30
    );
    const ultimaActualizacionDwh = logRes.recordset?.[0]?.UltimaActualizacion || "";

    res.json({
      periodosDisponibles,
      periodoActivo: periodo,
      ultimaActualizacionDwh,
      autoCalcFaltantesDiarios,
      versionSignature: getCombinedVersionSignature(),
      kpis: kpiResult.recordset?.[0] || {},
      productividadDiaria: prodVivoRes.recordset || [],
      metasMensuales: metasMensualesRes.recordset || [],
      historialMetasMensuales: historialMetasRes.recordset || [],
      administradores: adminsRes.recordset || [],
      moraPotencial: moraPotencialRows,
      moraPrimerDia: moraPrimerDiaRows,
      metaAsesorHoy: metaAsesorHoyRes.recordset?.[0] || {
        metaOpDia: 0,
        metaMontoDia: 0,
        fechaActualizacion: "",
      },
      proyeccionRepagos: proyeccionRepagosRes.recordset || [],
    });
  } catch (error) {
    console.error("Error en /api/welcome/init:", error);
    res.status(500).json({ error: "Error cargando el centro de mando Welcome" });
  }
});

// GUARDAR METAS DIARIAS Y PROYECCIONES (UNIFICADO EN fct_metas_diarias_control)
router.post(["/welcome/metas-diarias", "/api/welcome/metas-diarias"], async (req: Request, res: Response) => {
  try {
    await ensureWelcomeTables();
    const { filas, usuarioNombre, usuarioRol, autoCalcFaltantesDiarios } = req.body;

    if (typeof autoCalcFaltantesDiarios === "boolean") {
      const cfgRes = await pool.request().query(`
        SELECT TOP 1 [Config_Json] FROM [DWH_Gestion_Cartera].[dbo].[cfg_sistema_control] WHERE [Id] = 1
      `);
      let fullJson: any = {};
      try {
        fullJson = cfgRes.recordset?.[0]?.Config_Json
          ? JSON.parse(cfgRes.recordset[0].Config_Json)
          : {};
      } catch {}
      fullJson.daemon = {
        ...(fullJson.daemon || {}),
        autoCalcFaltantesDiarios,
      };
      await pool
        .request()
        .input("json", sql.NVarChar(sql.MAX), JSON.stringify(fullJson))
        .input("autor", sql.VarChar(150), String(usuarioNombre || "Super Admin").slice(0, 150))
        .input("rol", sql.VarChar(60), String(usuarioRol || "SUPER_ADMIN").slice(0, 60))
        .query(`
          IF EXISTS (SELECT 1 FROM [DWH_Gestion_Cartera].[dbo].[cfg_sistema_control] WHERE [Id] = 1)
            UPDATE [DWH_Gestion_Cartera].[dbo].[cfg_sistema_control]
            SET [Config_Json] = @json, [Actualizado_Por] = @autor, [Usuario_Rol] = @rol, [Fecha_Actualizacion] = GETDATE()
            WHERE [Id] = 1;
          ELSE
            INSERT INTO [DWH_Gestion_Cartera].[dbo].[cfg_sistema_control] ([Id], [Config_Json], [Actualizado_Por], [Usuario_Rol])
            VALUES (1, @json, @autor, @rol);
        `);
    }

    if (!Array.isArray(filas) || filas.length === 0) {
      return res.json({ ok: true, message: "Configuración de cálculo actualizada" });
    }

    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      for (const f of filas) {
        const idAge = (resolveAgencyCode(f.idAgencia || f.agencia) || "01").slice(0, 2);
        const opFaltantes = Math.round(Number(f.opFaltantesDia || 0));
        const crecFaltante = Number(f.crecFaltanteDia || 0);
        const sugOp = opFaltantes + 1;
        const sugMonto = crecFaltante + 500;
        const proyOp = f.proyeccionColocacion !== undefined ? Math.round(Number(f.proyeccionColocacion || 0)) : 0;
        const proyMonto = f.proyeccionMonto !== undefined ? Number(f.proyeccionMonto || 0) : 0;

        await new sql.Request(transaction)
          .input("idAge", sql.VarChar(2), idAge)
          .input("opFaltantes", sql.Int, opFaltantes)
          .input("crecFaltante", sql.Float, crecFaltante)
          .input("sugOp", sql.Int, sugOp)
          .input("sugMonto", sql.Float, sugMonto)
          .input("proyOp", sql.Int, proyOp)
          .input("proyMonto", sql.Float, proyMonto)
          .input("autor", sql.VarChar(150), String(usuarioNombre || "Usuario").slice(0, 150))
          .query(`
            DECLARE @Hoy DATE = CAST(DATEADD(hour, -5, GETUTCDATE()) AS DATE);

            IF EXISTS (SELECT 1 FROM [DWH_Gestion_Cartera].[dbo].[fct_metas_diarias_control] WHERE [Fecha] = @Hoy AND [IdSAgencia] = @idAge)
            BEGIN
              UPDATE [DWH_Gestion_Cartera].[dbo].[fct_metas_diarias_control]
              SET
                [Op_Faltantes_Dia] = CASE WHEN @opFaltantes > 0 THEN @opFaltantes ELSE [Op_Faltantes_Dia] END,
                [Crec_Faltante_Dia] = CASE WHEN @crecFaltante > 0 THEN @crecFaltante ELSE [Crec_Faltante_Dia] END,
                [Sugerencia_Op_Gerencia] = (CASE WHEN @opFaltantes > 0 THEN @opFaltantes ELSE [Op_Faltantes_Dia] END) + 1,
                [Sugerencia_Monto_Gerencia] = (CASE WHEN @crecFaltante > 0 THEN @crecFaltante ELSE [Crec_Faltante_Dia] END) + 500,
                [Proy_Op_Admin] = @proyOp,
                [Proy_Monto_Admin] = @proyMonto,
                [Actualizado_Por] = @autor,
                [Rol_Editor] = 'WEB_PENDIENTE_SYNC',
                [Fecha_Actualizacion] = GETDATE()
              WHERE [Fecha] = @Hoy AND [IdSAgencia] = @idAge;
            END
            ELSE
            BEGIN
              INSERT INTO [DWH_Gestion_Cartera].[dbo].[fct_metas_diarias_control]
                ([Fecha], [IdSAgencia], [Op_Faltantes_Dia], [Crec_Faltante_Dia],
                 [Sugerencia_Op_Gerencia], [Sugerencia_Monto_Gerencia],
                 [Proy_Op_Admin], [Proy_Monto_Admin],
                 [Actualizado_Por], [Rol_Editor], [Fecha_Actualizacion])
              VALUES
                (@Hoy, @idAge, @opFaltantes, @crecFaltante, @sugOp, @sugMonto, @proyOp, @proyMonto, @autor, 'WEB_PENDIENTE_SYNC', GETDATE());
            END
          `);
      }

      await new sql.Request(transaction).query(`
        UPDATE [DWH_Gestion_Cartera].[dbo].[Log_Actualizacion]
        SET [UltimaActualizacion] = GETDATE()
        WHERE [Id] IN (1, 5);
      `);

      await transaction.commit();
      res.json({ ok: true, message: "Metas y proyecciones diarias guardadas en DWH_Gestion_Cartera" });
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  } catch (error) {
    console.error("Error guardando metas diarias:", error);
    res.status(500).json({ error: "Error al guardar las metas diarias" });
  }
});

router.post(["/welcome/meta-asesor", "/api/welcome/meta-asesor"], async (req: Request, res: Response) => {
  try {
    await ensureWelcomeTables();
    const { idAsesor, asesorNombre, idAgencia, metaOpDia, metaMontoDia } = req.body;
    const idAge = (resolveAgencyCode(idAgencia) || "01").slice(0, 2);
    const codigoAsesor = String(idAsesor || asesorNombre || "ASESOR").trim().slice(0, 30);

    await pool.request()
      .input("idAsesor", sql.VarChar(30), codigoAsesor)
      .input("idAge", sql.VarChar(2), idAge)
      .input("nombre", sql.VarChar(150), String(asesorNombre || codigoAsesor).slice(0, 150))
      .input("op", sql.Int, Number(metaOpDia || 0))
      .input("monto", sql.Float, Number(metaMontoDia || 0))
      .query(`
        DECLARE @Hoy DATE = CAST(DATEADD(hour, -5, GETUTCDATE()) AS DATE);
        IF EXISTS (SELECT 1 FROM [DWH_Gestion_Cartera].[dbo].[fct_metas_diarias_asesor] WHERE [Fecha] = @Hoy AND [IdSAsesor] = @idAsesor)
        BEGIN
          UPDATE [DWH_Gestion_Cartera].[dbo].[fct_metas_diarias_asesor]
          SET [Meta_Op_Dia] = @op, [Meta_Monto_Dia] = @monto, [AsesorNombre] = @nombre, [Fecha_Actualizacion] = GETDATE()
          WHERE [Fecha] = @Hoy AND [IdSAsesor] = @idAsesor;
        END
        ELSE
        BEGIN
          INSERT INTO [DWH_Gestion_Cartera].[dbo].[fct_metas_diarias_asesor]
            ([Fecha], [IdSAgencia], [IdSAsesor], [AsesorNombre], [Meta_Op_Dia], [Meta_Monto_Dia], [Fecha_Actualizacion])
          VALUES (@Hoy, @idAge, @idAsesor, @nombre, @op, @monto, GETDATE());
        END
        IF EXISTS (SELECT 1 FROM [DWH_Gestion_Cartera].[dbo].[Log_Actualizacion] WHERE [Id] = 1)
          UPDATE [DWH_Gestion_Cartera].[dbo].[Log_Actualizacion] SET [UltimaActualizacion] = GETDATE() WHERE [Id] = 1;
      `);

    res.json({ ok: true, message: "Meta registrada con éxito." });
  } catch (error) {
    console.error("Error guardando meta diaria de asesor:", error);
    res.status(500).json({ error: "Error guardando meta diaria del analista" });
  }
});

router.post(["/welcome/metas-mensuales", "/api/welcome/metas-mensuales"], async (req: Request, res: Response) => {
  try {
    await ensureWelcomeTables();
    const { periodo, filas, usuarioNombre, usuarioEmail, usuarioRol } = req.body;
    const cleanPeriodo = String(periodo || "").replace(/[^0-9]/g, "").slice(0, 6);
    if (!cleanPeriodo || !Array.isArray(filas)) {
      return res.status(400).json({ error: "Periodo y filas son obligatorios" });
    }

    await pool.request().query(`
      IF COL_LENGTH('[dm_productividad].[dbo].[FctMensual]', 'CrecimientoMeta') IS NULL
        ALTER TABLE [dm_productividad].[dbo].[FctMensual] ADD [CrecimientoMeta] FLOAT NULL;
    `);

    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      await new sql.Request(transaction)
        .input("periodo", sql.VarChar(6), cleanPeriodo)
        .query(`DELETE FROM [dm_productividad].[dbo].[FctMensual] WHERE [Periodo] = @periodo`);

      let totalOpBase = 0;
      let totalOpAjus = 0;
      let totalMontoAjus = 0;

      for (const row of filas) {
        const opMeta = Number(row.colocacionNumMeta || 0);
        const opAjus = Number(row.colocacionNumMetaAjus ?? opMeta);
        const montoMeta = Number(row.colocacionMontoMeta || 0);
        const montoAjus = Number(row.colocacionMontoMetaAjus ?? montoMeta);
        const asesMeta = Number(row.numeroAsesores || 0);
        const asesAjus = Number(row.numeroAsesoresAjus ?? asesMeta);
        const crecMeta = Number(row.crecimientoMeta ?? row.crecimientoMetaAjus ?? 0);
        const crecAjus = Number(row.crecimientoMetaAjus ?? crecMeta);
        const idAgeInt = parseInt(resolveAgencyCode(row.idAgencia || row.agencia) || "1", 10);

        totalOpBase += opMeta;
        totalOpAjus += opAjus;
        totalMontoAjus += montoAjus;

        await new sql.Request(transaction)
          .input("periodo", sql.VarChar(6), cleanPeriodo)
          .input("idAge", sql.Int, idAgeInt)
          .input("opMeta", sql.Int, opMeta)
          .input("opAjus", sql.Int, opAjus)
          .input("montoMeta", sql.Float, montoMeta)
          .input("montoAjus", sql.Float, montoAjus)
          .input("asesores", sql.Int, asesMeta)
          .input("asesoresAjus", sql.Int, asesAjus)
          .input("crecMeta", sql.Float, crecMeta)
          .input("crecAjus", sql.Float, crecAjus)
          .query(`
            INSERT INTO [dm_productividad].[dbo].[FctMensual]
              ([Periodo], [IdSAgencia], [ColocacionNumMeta], [ColocacionNumMetaAjus], [ColocacionMontoMeta], [ColocacionMontoMetaAjus], [NumeroAsesores], [NumeroAsesoresAjus], [CrecimientoMeta], [CrecimientoMetaAjus])
            VALUES
              (@periodo, @idAge, @opMeta, @opAjus, @montoMeta, @montoAjus, @asesores, @asesoresAjus, @crecMeta, @crecAjus)
          `);
      }

      const diffOp = totalOpAjus - totalOpBase;
      const diffSign = diffOp >= 0 ? `+${diffOp}` : `${diffOp}`;
      const resumen = `Actualizó metas del periodo ${cleanPeriodo} (${filas.length} agencias · Meta Op Base: ${totalOpBase} | Ajustada: ${totalOpAjus} [${diffSign} op.] · Monto Ajustado: S/ ${totalMontoAjus.toLocaleString("es-PE")})`;

      await new sql.Request(transaction)
        .input("periodo", sql.VarChar(6), cleanPeriodo)
        .input("nombre", sql.VarChar(150), String(usuarioNombre || "Super Admin").slice(0, 150))
        .input("email", sql.VarChar(150), String(usuarioEmail || "").slice(0, 150))
        .input("rol", sql.VarChar(60), String(usuarioRol || "SUPER_ADMIN").slice(0, 60))
        .input("resumen", sql.NVarChar(sql.MAX), resumen)
        .query(`
          INSERT INTO [DWH_Gestion_Cartera].[dbo].[auditoria_metas_mensuales]
            ([Periodo], [Usuario_Nombre], [Usuario_Email], [Usuario_Rol], [Resumen_Cambio], [Fecha_Hora])
          VALUES (@periodo, @nombre, @email, @rol, @resumen, GETDATE());

          IF EXISTS (SELECT 1 FROM [DWH_Gestion_Cartera].[dbo].[Log_Actualizacion] WHERE [Id] = 1)
            UPDATE [DWH_Gestion_Cartera].[dbo].[Log_Actualizacion] SET [UltimaActualizacion] = GETDATE() WHERE [Id] = 1;
        `);

      await transaction.commit();
      res.json({ ok: true, message: "Metas mensuales guardadas y registradas en historial." });
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  } catch (error) {
    console.error("Error guardando metas mensuales:", error);
    res.status(500).json({ error: "Error guardando metas mensuales" });
  }
});

router.post(["/welcome/administradores", "/api/welcome/administradores"], async (req: Request, res: Response) => {
  try {
    await ensureWelcomeTables();
    const { periodo, filas } = req.body;
    const cleanPeriodo = String(periodo || "").replace(/[^0-9]/g, "").slice(0, 6);
    if (!cleanPeriodo || !Array.isArray(filas)) {
      return res.status(400).json({ error: "Periodo y filas son requeridos" });
    }

    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      await new sql.Request(transaction)
        .input("periodo", sql.VarChar(6), cleanPeriodo)
        .query(`DELETE FROM [DWH_Gestion_Cartera].[dbo].[dim_administrador] WHERE [Periodo] = @periodo`);

      for (const r of filas) {
        const idAge = (resolveAgencyCode(r.idAgencia || r.agencia) || "01").slice(0, 2);
        await new sql.Request(transaction)
          .input("periodo", sql.VarChar(6), cleanPeriodo)
          .input("idAge", sql.Char(2), idAge)
          .input("nombre", sql.NVarChar(100), String(r.nombre || "").trim().slice(0, 100))
          .input("celular", sql.VarChar(30), String(r.celular || "").trim().slice(0, 30))
          .input("correoPers", sql.VarChar(120), String(r.correoPersonal || "").trim().slice(0, 120))
          .input("correoCorp", sql.VarChar(120), String(r.correoCorporativo || "").trim().slice(0, 120))
          .query(`
            INSERT INTO [DWH_Gestion_Cartera].[dbo].[dim_administrador]
              ([Periodo], [IdSAgencia], [Nombre], [Celular], [CorreoPersonal], [CorreoCorporativo])
            VALUES (@periodo, @idAge, @nombre, @celular, @correoPers, @correoCorp);
          `);
      }

      await new sql.Request(transaction).query(`
        IF EXISTS (SELECT 1 FROM [DWH_Gestion_Cartera].[dbo].[Log_Actualizacion] WHERE [Id] = 1)
          UPDATE [DWH_Gestion_Cartera].[dbo].[Log_Actualizacion] SET [UltimaActualizacion] = GETDATE() WHERE [Id] = 1;
      `);

      await transaction.commit();
      res.json({ ok: true, message: "Directorio de Administradores actualizado." });
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  } catch (error) {
    console.error("Error guardando administradores:", error);
    res.status(500).json({ error: "Error al guardar administradores" });
  }
});

router.post(["/welcome/compromiso-mora", "/api/welcome/compromiso-mora"], async (req: Request, res: Response) => {
  try {
    await ensureWelcomeTables();
    const { pagare, compromiso, fechaPromesa, usuarioNombre, usuarioRol } = req.body;
    if (!pagare) {
      return res.status(400).json({ error: "El pagaré es obligatorio" });
    }

    const pagareClean = String(pagare).trim().slice(0, 40);
    const compText = String(compromiso || "").trim().slice(0, 500);
    const fechaProm = fechaPromesa && String(fechaPromesa).trim() !== "" ? String(fechaPromesa).trim() : null;
    const autor = String(usuarioNombre || "Usuario").trim().slice(0, 150);
    const rol = String(usuarioRol || "ANALISTA").trim().slice(0, 60);

    await pool.request()
      .input("pagare", sql.VarChar(40), pagareClean)
      .input("compromiso", sql.NVarChar(500), compText)
      .input("fechaPromesa", sql.Date, fechaProm)
      .input("autor", sql.VarChar(150), autor)
      .input("rol", sql.VarChar(60), rol)
      .query(`
        IF EXISTS (SELECT 1 FROM [DWH_Gestion_Cartera].[dbo].[fct_compromisos_mora_web] WHERE [Pagare] = @pagare)
        BEGIN
          UPDATE [DWH_Gestion_Cartera].[dbo].[fct_compromisos_mora_web]
          SET
            [Compromiso_Anterior] = [Compromiso_Actual],
            [Fecha_Promesa_Anterior] = [Fecha_Promesa_Actual],
            [Autor_Anterior] = [Autor_Actual],
            [Rol_Anterior] = [Rol_Actual],
            [Fecha_Anterior] = [Fecha_Actualizacion],
            [Compromiso_Actual] = @compromiso,
            [Fecha_Promesa_Actual] = @fechaPromesa,
            [Autor_Actual] = @autor,
            [Rol_Actual] = @rol,
            [Fecha_Actualizacion] = GETDATE()
          WHERE [Pagare] = @pagare;
        END
        ELSE
        BEGIN
          DECLARE @CompPrevio NVARCHAR(500) = (
            SELECT TOP 1 [Compromiso]
            FROM [DWH_Gestion_Cartera].[dbo].[fct_riesgo_integral] WITH (NOLOCK)
            WHERE RTRIM(LTRIM([Pagare])) = @pagare AND [Compromiso] IS NOT NULL AND LTRIM(RTRIM([Compromiso])) <> ''
            ORDER BY [Fecha_Foto] DESC
          );
          DECLARE @FechaPrevia DATE = (
            SELECT TOP 1 [Fecha_Promesa]
            FROM [DWH_Gestion_Cartera].[dbo].[fct_riesgo_integral] WITH (NOLOCK)
            WHERE RTRIM(LTRIM([Pagare])) = @pagare AND [Compromiso] IS NOT NULL AND LTRIM(RTRIM([Compromiso])) <> ''
            ORDER BY [Fecha_Foto] DESC
          );

          INSERT INTO [DWH_Gestion_Cartera].[dbo].[fct_compromisos_mora_web]
            ([Pagare], [Compromiso_Actual], [Fecha_Promesa_Actual], [Autor_Actual], [Rol_Actual], [Fecha_Actualizacion],
             [Compromiso_Anterior], [Fecha_Promesa_Anterior], [Autor_Anterior], [Rol_Anterior], [Fecha_Anterior])
          VALUES
            (@pagare, @compromiso, @fechaPromesa, @autor, @rol, GETDATE(),
             @CompPrevio, @FechaPrevia, CASE WHEN @CompPrevio IS NOT NULL THEN 'Registro Previo' ELSE NULL END, CASE WHEN @CompPrevio IS NOT NULL THEN 'ANALISTA' ELSE NULL END, CASE WHEN @CompPrevio IS NOT NULL THEN GETDATE() ELSE NULL END);
        END

        INSERT INTO [DWH_Gestion_Cartera].[dbo].[fct_compromisos_mora_historial]
          ([Pagare], [Compromiso], [Fecha_Promesa], [Autor_Nombre], [Autor_Rol], [Fecha_Registro])
        VALUES (@pagare, @compromiso, @fechaPromesa, @autor, @rol, GETDATE());

        UPDATE [DWH_Gestion_Cartera].[dbo].[fct_riesgo_integral]
        SET
          [Compromiso] = @compromiso,
          [Fecha_Promesa] = @fechaPromesa
        WHERE RTRIM(LTRIM([Pagare])) = @pagare
          AND [Fecha_Foto] = (SELECT MAX([Fecha_Foto]) FROM [DWH_Gestion_Cartera].[dbo].[fct_riesgo_integral]);

        IF EXISTS (SELECT 1 FROM [DWH_Gestion_Cartera].[dbo].[Log_Actualizacion] WHERE [Id] = 4)
          UPDATE [DWH_Gestion_Cartera].[dbo].[Log_Actualizacion] SET [UltimaActualizacion] = GETDATE() WHERE [Id] IN (1, 4);
      `);

    res.json({ ok: true, message: "Compromiso guardado con éxito." });
  } catch (error) {
    console.error("Error guardando compromiso de mora:", error);
    res.status(500).json({ error: "Error al guardar el compromiso de pago" });
  }
});

const DEFAULT_SYSTEM_CONFIG = {
  daemon: {
    horaInicioOperacion: 6,
    horaFinOperacion: 22,
    intervaloCicloBaseSeg: 120,
    horaFinMantenimientoMetas: 8,
    horaCorteCalculoFaltantes: "08:00",
    horaEjecucionIaRanking: "08:30",
    intervaloMoraRiesgoMin: 120,
    intervaloPlazoFijoHoras: 12,
    autoCalcFaltantesDiarios: false,
    forzarMoraAhora: false,
    forzarIaRankingAhora: false,
    forzarPlazoFijoAhora: false,
  },
  polling: {
    smartCacheWatcherSeg: 10,
    biFiltrosPollingSeg: 120,
    welcomeVivoPollingSeg: 5,
    welcomeGeneralPollingSeg: 20,
  },
  permisos: {
    GLOBAL: {
      scope: "GLOBAL",
      welcomeTabs: ["vivo", "metas_diarias", "metas_mensuales", "administradores", "mora", "cancelados", "avance", "config_sistema"],
      biViews: ["gerencia", "balance", "reporte", "plazoFijo", "moraProducto", "supervision", "agencia", "traspasosRecuperacion", "asesores", "colocaciones", "diaria", "mora", "evolucion", "cancelados", "avance", "ranking"],
    },
    AGENCIA: {
      scope: "AGENCIA",
      welcomeTabs: ["vivo", "mora", "cancelados", "avance"],
      biViews: ["balance", "agencia", "traspasosRecuperacion", "moraProducto", "asesores", "colocaciones", "diaria", "mora", "evolucion", "cancelados", "avance", "ranking"],
    },
    ASESOR: {
      scope: "USUARIO",
      welcomeTabs: ["mora", "cancelados", "avance"],
      biViews: ["asesores", "colocaciones", "diaria", "mora", "cancelados", "avance", "ranking"],
    },
    RECUPERADOR: {
      scope: "USUARIO",
      welcomeTabs: ["mora", "cancelados", "avance"],
      biViews: ["agencia", "traspasosRecuperacion", "moraProducto", "mora", "cancelados", "avance"],
    },
  },
};

router.get(["/welcome/config-sistema", "/api/welcome/config-sistema"], async (_req: Request, res: Response) => {
  try {
    await ensureWelcomeTables();
    const result = await pool.request().query(`
      SELECT TOP 1
        [Config_Json],
        ISNULL([Actualizado_Por], 'Valores por Defecto') AS Actualizado_Por,
        ISNULL([Usuario_Rol], 'SISTEMA') AS Usuario_Rol,
        FORMAT([Fecha_Actualizacion], 'dd/MM/yyyy HH:mm:ss') AS Fecha_Actualizacion
      FROM [DWH_Gestion_Cartera].[dbo].[cfg_sistema_control] WITH (NOLOCK)
      WHERE [Id] = 1;
    `);

    if (!result.recordset.length) {
      return res.json({
        config: DEFAULT_SYSTEM_CONFIG,
        actualizadoPor: "Sistema (Por defecto)",
        fechaActualizacion: "",
      });
    }

    const row = result.recordset[0];
    let parsed = DEFAULT_SYSTEM_CONFIG;
    try {
      const dbJson = JSON.parse(row.Config_Json);
      parsed = {
        daemon: { ...DEFAULT_SYSTEM_CONFIG.daemon, ...(dbJson.daemon || {}) },
        polling: { ...DEFAULT_SYSTEM_CONFIG.polling, ...(dbJson.polling || {}) },
        permisos: { ...DEFAULT_SYSTEM_CONFIG.permisos, ...(dbJson.permisos || {}) },
      };
    } catch {}

    res.json({
      config: parsed,
      actualizadoPor: row.Actualizado_Por,
      usuarioRol: row.Usuario_Rol,
      fechaActualizacion: row.Fecha_Actualizacion,
    });
  } catch (error) {
    console.error("Error obteniendo config-sistema:", error);
    res.status(500).json({ error: "Error leyendo configuración del sistema" });
  }
});

router.post(["/welcome/config-sistema", "/api/welcome/config-sistema"], async (req: Request, res: Response) => {
  try {
    await ensureWelcomeTables();
    const { config, usuarioNombre, usuarioRol } = req.body;
    if (!config) {
      return res.status(400).json({ error: "El objeto config es requerido" });
    }

    const jsonStr = JSON.stringify(config);
    await pool.request()
      .input("json", sql.NVarChar(sql.MAX), jsonStr)
      .input("autor", sql.VarChar(150), String(usuarioNombre || "Super Admin").slice(0, 150))
      .input("rol", sql.VarChar(60), String(usuarioRol || "SUPER_ADMIN").slice(0, 60))
      .query(`
        IF EXISTS (SELECT 1 FROM [DWH_Gestion_Cartera].[dbo].[cfg_sistema_control] WHERE [Id] = 1)
          UPDATE [DWH_Gestion_Cartera].[dbo].[cfg_sistema_control]
          SET [Config_Json] = @json,
              [Actualizado_Por] = @autor,
              [Usuario_Rol] = @rol,
              [Fecha_Actualizacion] = GETDATE()
          WHERE [Id] = 1;
        ELSE
          INSERT INTO [DWH_Gestion_Cartera].[dbo].[cfg_sistema_control]
            ([Id], [Config_Json], [Actualizado_Por], [Usuario_Rol], [Fecha_Actualizacion])
          VALUES (1, @json, @autor, @rol, GETDATE());
      `);

    res.json({ ok: true, message: "Configuración de horarios y accesos guardada en SQL Server." });
  } catch (error) {
    console.error("Error guardando config-sistema:", error);
    res.status(500).json({ error: "No se pudo guardar la configuración del sistema" });
  }
});

export default router;