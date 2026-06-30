import { Router } from 'express';
import type { AppContext } from '../../context.js';
import { todayISO } from '../../lib/dates.js';
import { audit } from '../../lib/audit.js';
import { writeValuationsCsv } from './service.js';

export function exportRoutes(ctx: AppContext): Router {
  const router = Router();

  // A user-portable CSV of every recorded valuation — distinct from the
  // whole-database backups (see modules/backup), which aren't a spreadsheet
  // format and cover all users. GET is safe to expose without extra CSRF
  // handling: csrfProtection only checks mutating methods, and a download
  // triggered cross-site can't read the response back into another page.
  router.get('/valuations.csv', (req, res) => {
    audit(ctx.db, { userId: req.user!.id, action: 'export.csv', ip: req.ip });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="concise-export-${todayISO(ctx.now)}.csv"`);
    writeValuationsCsv(ctx, req.user!.id, req.user!.currency, res);
    res.end();
  });

  return router;
}
