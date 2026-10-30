// D:\Proyectos\power-bi-web_backend\src\routes\welcome.ts
import { Router, Request, Response } from "express";
import sql from "mssql";
import { pool } from "../lib/db";
import { getCombinedVersionSignature } from "../middlewares/smartCache";

const router = Router();

const AGENCY_MAP: Record<string, string> = {
  "01": "Wanchaq",
  "02": "San Jerónimo",
  "03": "Quillabamba",
  "04": "Sicuani",
  "05": "Molino",
  "06": "Juliaca",
  "07": "Lima Los Olivos",
  "08": "Tica Tica",
  "09": "Magisterio",
  "10": "Lima SJL",
  "11": "Chiclayo",
  "12": "Arequipa",
  "13": "Pucallpa",
};

const NAME_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(AGENCY_MAP).map(([k, v]) => [v.toUpperCase(), k])
);

let tablesEnsured = false;

async function ensureWelcomeTables() {
  if (tablesEnsured) return;
  await pool.request().query(`
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
  `);
  tablesEnsured = true;
}

router.get(["/welcome/init", "/api/welcome/init"], async (req: Request, res: Response) => {
  try {
    await ensureWelcomeTables();

    const periodoReq = (req.query.periodo as string) || "";
    const agenciaCodeReq = (req.query.id_age as string) || "";
    const asesorReq = (req.query.asesor as string) || "";

    // 1. Obtener la lista completa de periodos históricos disponibles desde dim_calendario
    const periodosRes = await pool.request().query(`
      SELECT DISTINCT RTRIM(LTRIM([Periodo])) AS Periodo 
      FROM [dm_productividad].[dbo].[dim_calendario] WITH (NOLOCK)
      WHERE [Periodo] IS NOT NULL AND LTRIM(RTRIM([Periodo])) <> ''
      ORDER BY RTRIM(LTRIM([Periodo])) DESC
    `);
    const periodosDisponibles = periodosRes.recordset.map((p: any) => p.Periodo);

    // Periodo activo: si el usuario seleccionó uno, usa ese; si no, el más reciente de la lista
    const periodo = periodoReq || periodosDisponibles[0] || new Date().toISOString().slice(0,7).replace('-','');
    const idAgencia = agenciaCodeReq ? agenciaCodeReq.trim().padStart(2, "0") : "";

    // 1.1. PERSISTENCIA AUTOMÁTICA DE ADMINISTRADORES AL CAMBIAR DE PERIODO
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

    // 1.2. KPIs RESUMIDOS COMERCIALES (PERIODO ACTUAL VS PERIODO ANTERIOR)
    const kpiRequest = pool.request()
      .input("periodo", sql.VarChar(6), periodo)
      .input("idAgencia", sql.VarChar(2), idAgencia)
      .input("asesor", sql.VarChar(150), asesorReq.trim());

    const kpiResult = await kpiRequest.query(`
      DECLARE @FechaBase DATE = TRY_CAST(@periodo + '01' AS DATE);
      DECLARE @periodoAnt VARCHAR(6) = CASE 
        WHEN @FechaBase IS NOT NULL THEN CONVERT(VARCHAR(6), DATEADD(MONTH, -1, @FechaBase), 112)
        ELSE ''
      END;

      WITH AsesoresComerciales AS (
        -- ✅ Solo Parte Comercial (Excluye RECUPERADOR para no sumar la cartera de recuperación)
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
          -- ✅ Cartera Comercial (Solo asesores comerciales, sin recuperadores)
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
      Actual AS (
        SELECT * FROM ResumenPorPeriodo WHERE Periodo = @periodo
      ),
      Anterior AS (
        SELECT * FROM ResumenPorPeriodo WHERE Periodo = @periodoAnt
      ),
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
    `);

    // 1.3. PRODUCTIVIDAD EN VIVO POR AGENCIA
    const prodVivoRes = await pool.request().input("periodo", sql.VarChar(6), periodo).query(`
      DECLARE @Hoy DATE = CAST(DATEADD(hour, -5, GETUTCDATE()) AS DATE);

      WITH Agencias AS (
        SELECT * FROM (VALUES
          ('01', 'Wanchaq'), ('02', 'San Jerónimo'), ('03', 'Quillabamba'),
          ('04', 'Sicuani'), ('05', 'Molino'), ('06', 'Juliaca'),
          ('07', 'Lima Los Olivos'), ('08', 'Tica Tica'), ('09', 'Magisterio'),
          ('10', 'Lima SJL'), ('11', 'Chiclayo'), ('12', 'Arequipa'),
          ('13', 'Pucallpa')
        ) AS t(IdSAgencia, NombreAgencia)
      ),
      MetasHoy AS (
        SELECT
          RIGHT('00' + CAST(IdSAgencia AS VARCHAR(2)), 2) AS IdSAgencia,
          ISNULL(ColocacionNumMeta, 0) AS opFaltantesDia,
          ISNULL(ColocacionMontoMeta, 0) AS crecFaltanteDia,
          ISNULL(ColocacionNumProy, 0) AS proyOpDia,
          ISNULL(ColocacionMontoProy, 0) AS proyMontoDia
        FROM [dm_productividad].[dbo].[FctDiario_MetaProy] WITH (NOLOCK)
        WHERE Fecha = @Hoy
      ),
      ControlHoy AS (
        SELECT
          IdSAgencia,
          Op_Faltantes_Dia,
          Crec_Faltante_Dia,
          Sugerencia_Op_Gerencia,
          Sugerencia_Monto_Gerencia,
          Proy_Op_Admin,
          Proy_Monto_Admin,
          Actualizado_Por,
          Rol_Editor,
          CONVERT(VARCHAR(19), Fecha_Actualizacion, 120) AS Fecha_Actualizacion
        FROM [DWH_Gestion_Cartera].[dbo].[fct_metas_diarias_control] WITH (NOLOCK)
        WHERE Fecha = @Hoy
      ),
      SumaAsesoresHoy AS (
        SELECT
          IdSAgencia,
          SUM(Meta_Op_Dia) AS sumaOpAsesores,
          SUM(Meta_Monto_Dia) AS sumaMontoAsesores
        FROM [DWH_Gestion_Cartera].[dbo].[fct_metas_diarias_asesor] WITH (NOLOCK)
        WHERE Fecha = @Hoy
        GROUP BY IdSAgencia
      ),
      LogradoHoy AS (
        SELECT
          RTRIM(LTRIM(IdSAgencia)) AS IdSAgencia,
          ISNULL(SUM(ColocacionNumReal), 0) AS colocacionNumReal,
          ISNULL(SUM(ColocacionMontoReal), 0) AS colocacionMontoReal
        FROM [DWH_Gestion_Cartera].[dbo].[fct_flow] WITH (NOLOCK)
        WHERE Periodo = @periodo AND CAST(Fecha AS DATE) = @Hoy
        GROUP BY RTRIM(LTRIM(IdSAgencia))
      )
      SELECT
        CONVERT(VARCHAR(10), @Hoy, 120) AS fecha,
        @periodo AS periodo,
        A.IdSAgencia AS idAgencia,
        A.NombreAgencia AS agencia,
        COALESCE(C.Op_Faltantes_Dia, M.opFaltantesDia, 12) AS opFaltantesDia,
        COALESCE(C.Crec_Faltante_Dia, M.crecFaltanteDia, 20000) AS crecFaltanteDia,
        COALESCE(C.Sugerencia_Op_Gerencia, M.proyOpDia, 10) AS sugerenciaOpGerencia,
        COALESCE(C.Sugerencia_Monto_Gerencia, M.proyMontoDia, 20000) AS sugerenciaMontoGerencia,
        COALESCE(C.Proy_Op_Admin, M.proyOpDia, C.Sugerencia_Op_Gerencia, 0) AS proyeccionColocacion,
        COALESCE(C.Proy_Monto_Admin, M.proyMontoDia, C.Sugerencia_Monto_Gerencia, 0) AS proyeccionMonto,
        ISNULL(SA.sumaOpAsesores, 0) AS sumaOpAsesores,
        ISNULL(SA.sumaMontoAsesores, 0) AS sumaMontoAsesores,
        ISNULL(L.colocacionNumReal, 0) AS colocacionNumReal,
        ISNULL(L.colocacionMontoReal, 0) AS colocacionMontoReal,
        ISNULL(C.Actualizado_Por, 'Sistema / Daemon') AS actualizadoPor,
        ISNULL(C.Rol_Editor, '') AS rolEditor,
        ISNULL(C.Fecha_Actualizacion, '') AS fechaActualizacion
      FROM Agencias A
      LEFT JOIN MetasHoy M ON A.IdSAgencia = M.IdSAgencia
      LEFT JOIN ControlHoy C ON A.IdSAgencia = C.IdSAgencia
      LEFT JOIN SumaAsesoresHoy SA ON A.IdSAgencia = SA.IdSAgencia
      LEFT JOIN LogradoHoy L ON A.IdSAgencia = L.IdSAgencia
      ORDER BY A.IdSAgencia ASC;
    `);

    // 1.4. METAS MENSUALES + HISTORIAL
    const metasMensualesRes = await pool.request().input("periodo", sql.VarChar(6), periodo).query(`
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
    `);

    const historialMetasRes = await pool.request().input("periodo", sql.VarChar(6), periodo).query(`
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
    `);

    // 1.5. TABLA DE ADMINISTRADORES
    const adminsRes = await pool.request().input("periodo", sql.VarChar(6), periodo).query(`
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
    `);

    // 1.6. MORA POTENCIAL
    const moraRes = await pool.request()
      .input("idAgencia", sql.VarChar(2), idAgencia)
      .input("asesor", sql.VarChar(150), asesorReq.trim())
      .query(`
        DECLARE @UltimaFecha DATE = (
          SELECT MAX([Fecha_Foto]) FROM [DWH_Gestion_Cartera].[dbo].[fct_riesgo_integral] WITH (NOLOCK)
        );

        SELECT
          R.[IdSAgencia] AS idAgencia,
          CASE R.[IdSAgencia]
            WHEN '01' THEN 'Wanchaq' WHEN '02' THEN 'San Jerónimo' WHEN '03' THEN 'Quillabamba'
            WHEN '04' THEN 'Sicuani' WHEN '05' THEN 'Molino' WHEN '06' THEN 'Juliaca'
            WHEN '07' THEN 'Lima Los Olivos' WHEN '08' THEN 'Tica Tica' WHEN '09' THEN 'Magisterio'
            WHEN '10' THEN 'Lima SJL' WHEN '11' THEN 'Chiclayo' WHEN '12' THEN 'Arequipa'
            WHEN '13' THEN 'Pucallpa' ELSE 'Otra Agencia'
          END AS agencia,
          RTRIM(LTRIM(R.[IdSAsesor])) AS idAsesor,
          ISNULL(D_AS.NombreAsesor, RTRIM(LTRIM(R.[IdSAsesor]))) AS asesor,
          RTRIM(LTRIM(R.[Pagare])) AS pagare,
          CASE
            WHEN R.[Cuenta] IS NULL OR LTRIM(RTRIM(R.[Cuenta])) = '' THEN ''
            ELSE RIGHT('000000000000' + LTRIM(RTRIM(R.[Cuenta])), 12)
          END AS cuenta,
          RTRIM(LTRIM(R.[Socio])) AS socio,
          RTRIM(LTRIM(ISNULL(R.[Producto], ''))) AS producto,
          ISNULL(R.[Saldo_Capital], 0) AS saldoCapital,
          ISNULL(R.[Cuota_Mensual], 0) AS cuotaMensual,
          ISNULL(R.[Cuotas_Atrasadas], 0) AS cuotasAtrasadas,
          ISNULL(R.[Dias_Atraso], 0) AS diasAtraso,
          ISNULL(R.[Cuotas_Pendientes], 0) AS cuotasPendientes,
          ISNULL(R.[Cuotas_Pagadas], 0) AS cuotasPagadas,
          ISNULL(R.[Avance_Cuota], '0%') AS avanceCuota,
          ISNULL(R.[Telefonos], '') AS telefonos,
          R.[Probabilidad_IA] AS probabilidadIa,
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
        OUTER APPLY (
          SELECT TOP 1 ISNULL(DA.[AsesorNombresApellidos], DA.[Asesor]) AS NombreAsesor
          FROM [DWH_Gestion_Cartera].[dbo].[dim_asesor] DA WITH (NOLOCK)
          WHERE RTRIM(LTRIM(DA.[IdSAsesor])) = RTRIM(LTRIM(R.[IdSAsesor]))
          ORDER BY DA.[Periodo] DESC
        ) D_AS
        WHERE R.[Fecha_Foto] = @UltimaFecha
          AND R.[Estado_Mora] = '3. Mora Potencial'
          AND (@idAgencia = '' OR RTRIM(LTRIM(R.[IdSAgencia])) = @idAgencia)
          AND (
            @asesor = ''
            OR RTRIM(LTRIM(R.[IdSAsesor])) = @asesor
            OR RTRIM(LTRIM(D_AS.NombreAsesor)) LIKE '%' + @asesor + '%'
          )
        ORDER BY R.[Saldo_Capital] DESC;
      `);

    // 1.7. META DIARIA PROPIA DEL ANALISTA
    const metaAsesorHoyRes = await pool.request()
      .input("asesor", sql.VarChar(150), asesorReq.trim())
      .query(`
        SELECT TOP 1
          [Meta_Op_Dia] AS metaOpDia,
          [Meta_Monto_Dia] AS metaMontoDia,
          FORMAT([Fecha_Actualizacion], 'dd/MM/yyyy HH:mm') AS fechaActualizacion
        FROM [DWH_Gestion_Cartera].[dbo].[fct_metas_diarias_asesor] WITH (NOLOCK)
        WHERE [Fecha] = CAST(DATEADD(hour, -5, GETUTCDATE()) AS DATE)
          AND ([IdSAsesor] = @asesor OR [AsesorNombre] LIKE '%' + @asesor + '%')
      `);

    // 1.8. Hora oficial de última actualización en el DWH
    const logRes = await pool.request().query(`
      SELECT TOP (1)
        FORMAT([UltimaActualizacion], 'dd/MM/yyyy · hh:mm:ss tt', 'es-PE') AS UltimaActualizacion
      FROM [DWH_Gestion_Cartera].[dbo].[Log_Actualizacion] WITH (NOLOCK)
      ORDER BY [UltimaActualizacion] DESC
    `);
    const ultimaActualizacionDwh = logRes.recordset?.[0]?.UltimaActualizacion || "";

    res.json({
      periodosDisponibles,
      periodoActivo: periodo,
      ultimaActualizacionDwh,
      versionSignature: getCombinedVersionSignature(),
      kpis: kpiResult.recordset?.[0] || {},
      productividadDiaria: prodVivoRes.recordset || [],
      metasMensuales: metasMensualesRes.recordset || [],
      historialMetasMensuales: historialMetasRes.recordset || [],
      administradores: adminsRes.recordset || [],
      moraPotencial: moraRes.recordset || [],
      metaAsesorHoy: metaAsesorHoyRes.recordset?.[0] || { metaOpDia: 0, metaMontoDia: 0, fechaActualizacion: "" },
    });
  } catch (error) {
    console.error("Error en /api/welcome/init:", error);
    res.status(500).json({ error: "Error cargando el centro de mando Welcome" });
  }
});

router.post(["/welcome/metas-diarias", "/api/welcome/metas-diarias"], async (req: Request, res: Response) => {
  try {
    await ensureWelcomeTables();
    const { filas, usuarioNombre, usuarioRol } = req.body;
    if (!Array.isArray(filas) || filas.length === 0) {
      return res.status(400).json({ error: "No se enviaron filas para guardar" });
    }

    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      for (const f of filas) {
        const idAge = String(f.idAgencia || NAME_TO_CODE[String(f.agencia || "").toUpperCase()] || "01").padStart(2, "0");
        const opFaltantes = Number(f.opFaltantesDia || 0);
        const crecFaltante = Number(f.crecFaltanteDia || 0);
        const sugOp = f.sugerenciaOpGerencia !== undefined ? Number(f.sugerenciaOpGerencia) : null;
        const sugMonto = f.sugerenciaMontoGerencia !== undefined ? Number(f.sugerenciaMontoGerencia) : null;
        const proyOpAdmin = f.proyeccionColocacion !== undefined ? Number(f.proyeccionColocacion) : null;
        const proyMontoAdmin = f.proyeccionMonto !== undefined ? Number(f.proyeccionMonto) : null;

        await new sql.Request(transaction)
          .input("idAge", sql.VarChar(2), idAge)
          .input("opFaltantes", sql.Int, opFaltantes)
          .input("crecFaltante", sql.Float, crecFaltante)
          .input("sugOp", sql.Int, sugOp)
          .input("sugMonto", sql.Float, sugMonto)
          .input("proyOpAdmin", sql.Int, proyOpAdmin)
          .input("proyMontoAdmin", sql.Float, proyMontoAdmin)
          .input("autor", sql.VarChar(150), String(usuarioNombre || "Usuario"))
          .input("rol", sql.VarChar(50), String(usuarioRol || "GERENCIA"))
          .query(`
            DECLARE @Hoy DATE = CAST(DATEADD(hour, -5, GETUTCDATE()) AS DATE);

            IF EXISTS (SELECT 1 FROM [DWH_Gestion_Cartera].[dbo].[fct_metas_diarias_control] WHERE [Fecha] = @Hoy AND [IdSAgencia] = @idAge)
            BEGIN
              UPDATE [DWH_Gestion_Cartera].[dbo].[fct_metas_diarias_control]
              SET
                [Op_Faltantes_Dia] = CASE WHEN @rol IN ('SUPER_ADMIN', 'GERENTE_GENERAL', 'JEFE_OPERACIONES') THEN @opFaltantes ELSE [Op_Faltantes_Dia] END,
                [Crec_Faltante_Dia] = CASE WHEN @rol IN ('SUPER_ADMIN', 'GERENTE_GENERAL', 'JEFE_OPERACIONES') THEN @crecFaltante ELSE [Crec_Faltante_Dia] END,
                [Sugerencia_Op_Gerencia] = COALESCE(@sugOp, [Sugerencia_Op_Gerencia]),
                [Sugerencia_Monto_Gerencia] = COALESCE(@sugMonto, [Sugerencia_Monto_Gerencia]),
                [Proy_Op_Admin] = COALESCE(@proyOpAdmin, [Proy_Op_Admin]),
                [Proy_Monto_Admin] = COALESCE(@proyMontoAdmin, [Proy_Monto_Admin]),
                [Actualizado_Por] = @autor,
                [Rol_Editor] = @rol,
                [Fecha_Actualizacion] = GETDATE()
              WHERE [Fecha] = @Hoy AND [IdSAgencia] = @idAge;
            END
            ELSE
            BEGIN
              INSERT INTO [DWH_Gestion_Cartera].[dbo].[fct_metas_diarias_control]
                ([Fecha], [IdSAgencia], [Op_Faltantes_Dia], [Crec_Faltante_Dia], [Sugerencia_Op_Gerencia], [Sugerencia_Monto_Gerencia], [Proy_Op_Admin], [Proy_Monto_Admin], [Actualizado_Por], [Rol_Editor], [Fecha_Actualizacion])
              VALUES
                (@Hoy, @idAge, @opFaltantes, @crecFaltante, @sugOp, @sugMonto, COALESCE(@proyOpAdmin, @sugOp, 0), COALESCE(@proyMontoAdmin, @sugMonto, 0), @autor, @rol, GETDATE());
            END

            DELETE FROM [dm_productividad].[dbo].[FctDiario_MetaProy]
            WHERE [Fecha] = @Hoy AND RIGHT('00' + CAST([IdSAgencia] AS VARCHAR(2)), 2) = @idAge;

            INSERT INTO [dm_productividad].[dbo].[FctDiario_MetaProy]
              ([Fecha], [IdSAgencia], [ColocacionNumMeta], [ColocacionNumProy], [ColocacionMontoMeta], [ColocacionMontoProy])
            SELECT
              @Hoy,
              CAST(@idAge AS BIGINT),
              [Op_Faltantes_Dia],
              ISNULL([Proy_Op_Admin], ISNULL([Sugerencia_Op_Gerencia], 0)),
              [Crec_Faltante_Dia],
              ISNULL([Proy_Monto_Admin], ISNULL([Sugerencia_Monto_Gerencia], 0))
            FROM [DWH_Gestion_Cartera].[dbo].[fct_metas_diarias_control]
            WHERE [Fecha] = @Hoy AND [IdSAgencia] = @idAge;
            IF EXISTS (SELECT 1 FROM [DWH_Gestion_Cartera].[dbo].[Log_Actualizacion] WHERE [Id] = 1)
            UPDATE [DWH_Gestion_Cartera].[dbo].[Log_Actualizacion] SET [UltimaActualizacion] = GETDATE() WHERE [Id] = 1;
          `);
      }

      await transaction.commit();
      res.json({ ok: true, message: "Metas diarias guardadas correctamente" });
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
    const idAge = String(idAgencia || "01").trim().padStart(2, "0");
    const codigoAsesor = String(idAsesor || asesorNombre || "ASESOR").trim();

    await pool.request()
      .input("idAsesor", sql.VarChar(30), codigoAsesor)
      .input("idAge", sql.VarChar(2), idAge)
      .input("nombre", sql.VarChar(150), String(asesorNombre || codigoAsesor))
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
            ([Fecha], [IdSAsesor], [IdSAgencia], [AsesorNombre], [Meta_Op_Dia], [Meta_Monto_Dia], [Fecha_Actualizacion])
          VALUES (@Hoy, @idAsesor, @idAge, @nombre, @op, @monto, GETDATE());
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
    if (!periodo || !Array.isArray(filas)) {
      return res.status(400).json({ error: "Periodo y filas son obligatorios" });
    }

    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      await new sql.Request(transaction)
        .input("periodo", sql.VarChar(6), String(periodo).trim())
        .query(`DELETE FROM [dm_productividad].[dbo].[FctMensual] WHERE [Periodo] = @periodo`);

      let totalOpAjus = 0;
      let totalMontoAjus = 0;

      for (const row of filas) {
        const opAjus = Number(row.colocacionNumMetaAjus || 0);
        const montoAjus = Number(row.colocacionMontoMetaAjus || 0);
        totalOpAjus += opAjus;
        totalMontoAjus += montoAjus;

        await new sql.Request(transaction)
          .input("periodo", sql.VarChar(6), String(periodo).trim())
          .input("idAge", sql.Int, parseInt(String(row.idAgencia || "1"), 10))
          .input("opMeta", sql.Int, Number(row.colocacionNumMeta || 0))
          .input("opAjus", sql.Int, opAjus)
          .input("montoMeta", sql.Float, Number(row.colocacionMontoMeta || 0))
          .input("montoAjus", sql.Float, montoAjus)
          .input("asesores", sql.Int, Number(row.numeroAsesores || 0))
          .input("asesoresAjus", sql.Int, Number(row.numeroAsesoresAjus || 0))
          .input("crecAjus", sql.Int, Number(row.crecimientoMetaAjus || row.crecimientoMeta || 0))
          .query(`
            INSERT INTO [dm_productividad].[dbo].[FctMensual]
              ([Periodo], [IdSAgencia], [ColocacionNumMeta], [ColocacionNumMetaAjus], [ColocacionMontoMeta], [ColocacionMontoMetaAjus], [NumeroAsesores], [NumeroAsesoresAjus], [CrecimientoMetaAjus])
            VALUES
              (@periodo, @idAge, @opMeta, @opAjus, @montoMeta, @montoAjus, @asesores, @asesoresAjus, @crecAjus)
          `);
      }

      const resumen = `Actualizó metas del periodo ${periodo} (${filas.length} agencias · Total Meta Op Ajustada: ${totalOpAjus} · Total Monto Ajustado: S/ ${totalMontoAjus.toLocaleString("es-PE")})`;

      await new sql.Request(transaction)
        .input("periodo", sql.VarChar(6), String(periodo).trim())
        .input("nombre", sql.VarChar(150), String(usuarioNombre || "Super Admin"))
        .input("email", sql.VarChar(150), String(usuarioEmail || ""))
        .input("rol", sql.VarChar(60), String(usuarioRol || "SUPER_ADMIN"))
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
    if (!periodo || !Array.isArray(filas)) {
      return res.status(400).json({ error: "Periodo y filas son requeridos" });
    }

    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      await new sql.Request(transaction)
        .input("periodo", sql.VarChar(6), String(periodo).trim())
        .query(`DELETE FROM [DWH_Gestion_Cartera].[dbo].[dim_administrador] WHERE [Periodo] = @periodo`);

      for (const r of filas) {
        const idAge = String(r.idAgencia || "01").trim().padStart(2, "0");
        await new sql.Request(transaction)
          .input("periodo", sql.VarChar(6), String(periodo).trim())
          .input("idAge", sql.Char(2), idAge)
          .input("nombre", sql.NVarChar(100), String(r.nombre || "").trim())
          .input("celular", sql.VarChar(30), String(r.celular || "").trim())
          .input("correoPers", sql.VarChar(120), String(r.correoPersonal || "").trim())
          .input("correoCorp", sql.VarChar(120), String(r.correoCorporativo || "").trim())
          .query(`
            INSERT INTO [DWH_Gestion_Cartera].[dbo].[dim_administrador]
              ([Periodo], [IdSAgencia], [Nombre], [Celular], [CorreoPersonal], [CorreoCorporativo])
            VALUES (@periodo, @idAge, @nombre, @celular, @correoPers, @correoCorp)
            IF EXISTS (SELECT 1 FROM [DWH_Gestion_Cartera].[dbo].[Log_Actualizacion] WHERE [Id] = 1)
            UPDATE [DWH_Gestion_Cartera].[dbo].[Log_Actualizacion] SET [UltimaActualizacion] = GETDATE() WHERE [Id] = 1;
          `);
      }

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

    const pagareClean = String(pagare).trim();
    const compText = String(compromiso || "").trim();
    const fechaProm = fechaPromesa && String(fechaPromesa).trim() !== "" ? String(fechaPromesa).trim() : null;
    const autor = String(usuarioNombre || "Usuario").trim();
    const rol = String(usuarioRol || "ANALISTA").trim();

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
          UPDATE [DWH_Gestion_Cartera].[dbo].[Log_Actualizacion] SET [UltimaActualizacion] = GETDATE() WHERE [Id] = 4;
      `);

    res.json({ ok: true, message: "Compromiso guardado con éxito." });
  } catch (error) {
    console.error("Error guardando compromiso de mora:", error);
    res.status(500).json({ error: "Error al guardar el compromiso de pago" });
  }
});

export default router;