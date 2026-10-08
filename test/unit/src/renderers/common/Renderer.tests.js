import Renderer from '../../../../../src/renderers/common/Renderer.js';
import Backend from '../../../../../src/renderers/common/Backend.js';
import BundleGroup from '../../../../../src/renderers/common/BundleGroup.js';
import WGSLNodeBuilder from '../../../../../src/renderers/webgpu/nodes/WGSLNodeBuilder.js';
import MeshBasicNodeMaterial from '../../../../../src/materials/nodes/MeshBasicNodeMaterial.js';
import { Scene } from '../../../../../src/scenes/Scene.js';
import { Mesh } from '../../../../../src/objects/Mesh.js';
import { BoxGeometry } from '../../../../../src/geometries/BoxGeometry.js';
import { PerspectiveCamera } from '../../../../../src/cameras/PerspectiveCamera.js';

// a backend that builds node materials but issues no GPU work

class RecordingBackend extends Backend {

	constructor() {

		super( { canvas: { style: {}, width: 1, height: 1, addEventListener() {}, removeEventListener() {} } } );

		this.utils = { getTextureSampleData: () => ( { primarySamples: 1 } ) };
		this.bundles = [];

	}

	async init( renderer ) {

		this.renderer = renderer;

	}

	get coordinateSystem() {

		return 2000;

	}

	createNodeBuilder( object, renderer ) {

		return new WGSLNodeBuilder( object, renderer );

	}

	addBundle( renderContext, bundle ) {

		this.bundles.push( bundle );

	}

}

function createBackend() {

	const noop = () => {};

	return new Proxy( new RecordingBackend(), {
		get( target, property ) {

			return property in target ? target[ property ] : noop;

		}
	} );

}

export default QUnit.module( 'Renderers', () => {

	QUnit.module( 'Common', () => {

		QUnit.module( 'Renderer', () => {

			QUnit.test( 'renders nested in a bundle recording do not add to the bundle', async ( assert ) => {

				const backend = createBackend();
				const renderer = new Renderer( backend );

				await renderer.init();

				const camera = new PerspectiveCamera();
				const geometry = new BoxGeometry();

				const nestedScene = new Scene();
				const nestedMesh = new Mesh( geometry, new MeshBasicNodeMaterial() );
				nestedScene.add( nestedMesh );

				// a render started while the bundle is recorded, like a shadow map that is updated
				// before the first bundled object that samples it is drawn

				const bundledMesh = new Mesh( geometry, new MeshBasicNodeMaterial() );
				bundledMesh.onBeforeRender = () => renderer.render( nestedScene, camera );

				const bundleGroup = new BundleGroup();
				bundleGroup.add( bundledMesh );

				const scene = new Scene();
				scene.add( bundleGroup );

				renderer.render( scene, camera );

				assert.strictEqual( backend.bundles.length, 1, 'One bundle recorded.' );

				const renderObjects = backend.get( backend.bundles[ 0 ] ).renderObjects;

				assert.deepEqual( renderObjects.map( ( renderObject ) => renderObject.object ), [ bundledMesh ], 'The bundle only holds its own content.' );
				assert.strictEqual( renderer._currentRenderBundle, null, 'No bundle recorded after the render.' );

				renderer.dispose();

			} );

		} );

	} );

} );
