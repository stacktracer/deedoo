export interface DisposeFn {
    ( ): unknown;
}

export interface Disposable {
    dispose( ): unknown;
}

export type Disposer = DisposeFn | Disposable;

export function dispose( disposer: Disposer ): void {
    if ( typeof disposer === 'function' ) {
        disposer( );
    }
    else {
        disposer.dispose( );
    }
}

export class DisposerGroup implements Disposable {
    protected members: Set<Disposer>;

    constructor( ) {
        this.members = new Set( );
    }

    add( disposer: Disposer ): void {
        this.members.add( disposer );
    }

    dispose( ): void {
        // Delete in reverse insertion order
        for ( const member of [ ...this.members ].reverse( ) ) {
            this.members.delete( member );
            dispose( member );
        }
    }
}
