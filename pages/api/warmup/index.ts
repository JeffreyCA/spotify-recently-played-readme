import { NextApiRequest, NextApiResponse } from 'next';
import { warmup } from '../../../utils/FirebaseUtil';

export default async (req: NextApiRequest, res: NextApiResponse): Promise<void> => {
    const { key } = req.query;
    if (process.env.WARMUP_KEY && key === process.env.WARMUP_KEY) {
        await warmup();
        res.statusCode = 200;
        res.json({ status: 'Success' });
        return;
    }
    res.statusCode = 400;
    res.json({ status: 'Failed' });
};
