// Список міграцій у порядку виконання. Нова міграція: додай клас сюди.
import { InitSchema1700000000001 } from './1700000000001-InitSchema';
import { AddPostEmbedding1700000000002 } from './1700000000002-AddPostEmbedding';
import { AddEventsUserCreatedIndex1700000000003 } from './1700000000003-AddEventsUserCreatedIndex';

export const migrations = [InitSchema1700000000001, AddPostEmbedding1700000000002, AddEventsUserCreatedIndex1700000000003];
