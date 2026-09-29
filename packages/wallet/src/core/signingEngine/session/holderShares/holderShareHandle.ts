declare const openHolderShareHandleBrand: unique symbol;

export type OpenHolderShareHandle = string & {
  readonly [openHolderShareHandleBrand]: 'OpenHolderShareHandle';
};
