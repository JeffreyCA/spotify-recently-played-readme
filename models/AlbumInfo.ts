import { ArtistInfo } from './ArtistInfo';
import { ImageInfo } from './ImageInfo';

export interface AlbumInfo {
    artists: ArtistInfo[];
    id: string;
    images: ImageInfo[];
    name: string;
    href: string;
    external_urls: {
        spotify: string;
    };
    uri: string;
}
