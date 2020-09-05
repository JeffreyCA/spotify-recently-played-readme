import { ArtistInfo } from './ArtistInfo';
import { AlbumInfo } from './AlbumInfo';

export interface TrackInfo {
    album: AlbumInfo;
    artists: ArtistInfo[];
    duration_ms: number;
    explicit: boolean;
    external_urls: {
        spotify: string;
    };
    href: string;
    id: string;
    name: string;
    uri: string;
    inlineimage: string;
}
