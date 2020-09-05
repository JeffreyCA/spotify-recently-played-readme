import { PlayHistory } from './PlayHistory';

export interface RecentlyPlayedResponse {
    href: string;
    items: PlayHistory[];
    limit: number;
}
