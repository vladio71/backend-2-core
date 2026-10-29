// Що це: доступ до Bull Board (/queues). У development відкритий; інакше потрібен JWT адміна
// (заголовок Authorization або ?token=, бо браузер не ставить заголовки на сторінку).
// Хто викликає: BullBoardModule.forRoot({ middleware }).
import { NextFunction, Request, Response } from 'express';
import { JwtService } from '../auth/jwt.service';
import { extractBearer } from '../auth/jwt-auth.guard';

export function createBullBoardAuth(jwt: JwtService, open: boolean) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (open) {
      next();
      return;
    }
    const token = extractBearer(req.headers.authorization) ?? (typeof req.query.token === 'string' ? req.query.token : null);
    try {
      const user = jwt.verify(token ?? '');
      if (user.role !== 'admin') throw new Error('not admin');
      next();
    } catch {
      res.status(401).json({ statusCode: 401, code: 'UNAUTHORIZED', message: 'Bull Board: потрібен JWT адміна (?token=...)' });
    }
  };
}
