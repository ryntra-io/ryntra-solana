/**
 * The terminal's kit: the parts every screen is built from, in the approved design's look
 * (docs/terminal/design/2026-11-16/). A screen takes its parts from here and writes no colour, face or size of its own.
 */
export { Panel, type PanelTone } from './Panel';
export { Action, Quiet, QuietLink } from './buttons';
export { Title, Kick, Figure } from './Type';
export { Tabs, Segment, type TabItem, type SegmentItem } from './Tabs';
export { Table, TableHead, TableRow, Cell, CoinCell, ListRow } from './Table';
export { Tile } from './Tile';
export { AmountField, Shares, amountText } from './AmountField';
export { Switch, SwitchRow, Slider, Chip } from './controls';
export { Columns, useColumnSet } from './Columns';
export { type ColumnSet } from './column-set';
export { SayLine } from './SayLine';
export { Info } from './Info';
export { Search } from './Search';
export { CoinLogo, coinIcon } from './CoinLogo';
export { priceText, usdText, changeText, changeTone, amountOf } from './figures';
export { Icon, type IconName } from './icons';
export { cx } from './cx';
