//routes/index.ts

import { Router, type IRouter } from "express";
import healthRouter from "./health";
import preventivaRouter from "./preventiva";
import filtrosRouter from "./filtros";
import calendarioRouter from "./calendario";
import gerenciaRouter from "./gerencia";
import supervisionRouter from "./supervision";
import agenciaRouter from "./agencia";
import asesoresRouter from "./asesores";
import diariaRouter from "./diaria";
import evolucionRoutes from './evolucion';
import canceladosRoutes from './cancelados';
import avanceRoutes from './avance';
import rankingRoutes from './ranking';

const router: IRouter = Router();

router.use(healthRouter);
router.use(preventivaRouter);
router.use(filtrosRouter);
router.use(calendarioRouter);
router.use(gerenciaRouter);
router.use(supervisionRouter);
router.use(agenciaRouter);
router.use(asesoresRouter);
router.use(diariaRouter);
router.use(evolucionRoutes);
router.use(canceladosRoutes);
router.use(avanceRoutes);
router.use(rankingRoutes);

export default router;